import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

type Device = {
  id: string;
  name: string;
  platform: string;
  last_seen_at: string | null;
};

type LockCommand = {
  id: string;
  action: string;
  status: "pending" | "claimed" | "completed" | "failed" | string;
  created_at: string;
  failure_reason?: string | null;
};

const HEARTBEAT_FRESHNESS_MS = 20000; // 20 seconds freshness window
const POLL_INTERVAL_MS = 4000; // 4 seconds coordinated poll

export default function HomeScreen() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");

  const [device, setDevice] = useState<Device | null>(null);
  const [deviceList, setDeviceList] = useState<Device[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState("");

  // Add Laptop modal state
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newLaptopName, setNewLaptopName] = useState("");
  const [addDeviceError, setAddDeviceError] = useState("");

  const [latestCommand, setLatestCommand] = useState<LockCommand | null>(null);
  const [commandHistory, setCommandHistory] = useState<LockCommand[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lockSubmitting, setLockSubmitting] = useState(false);
  const [statusError, setStatusError] = useState("");

  // Track time in state to comply with React 19 purity rules
  const [now, setNow] = useState<number>(() => Date.now());

  const isMountedRef = useRef(true);
  const isPollingBusyRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Update clock every 2 seconds for fresh relative times and status computation
  useEffect(() => {
    const clockTimer = setInterval(() => {
      if (isMountedRef.current) {
        setNow(Date.now());
      }
    }, 2000);

    return () => clearInterval(clockTimer);
  }, []);

  // Check the current login session on mount
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setMessage(error.message);
        return;
      }
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      setMessage("");
      setStatusError("");
      if (!newSession?.user?.id) {
        setDevice(null);
        setDeviceList([]);
        setLatestCommand(null);
        setCommandHistory([]);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Data fetching routines
  const fetchDevice = useCallback(
    async (userId: string, isManual = false) => {
      if (isManual && isMountedRef.current) {
        setDeviceLoading(true);
      }

      try {
        const { data, error } = await supabase
          .from("devices")
          .select("id, name, platform, last_seen_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (!isMountedRef.current) return null;

        if (error) {
          setMessage(`Could not load laptop: ${error.message}`);
          return null;
        }

        const devices = (data ?? []) as Device[];
        setDeviceList(devices);

        // Keep current selected device if it still exists; otherwise default to primary or first
        setDevice((prev) => {
          if (prev && devices.some((d) => d.id === prev.id)) {
            const updated = devices.find((d) => d.id === prev.id);
            return updated ?? prev;
          }
          const primary = devices.find((d) => d.name === "Windows 11 Laptop");
          return primary ?? (devices.length > 0 ? devices[0] : null);
        });

        const primary = devices.find((d) => d.name === "Windows 11 Laptop");
        return primary ?? (devices.length > 0 ? devices[0] : null);
      } finally {
        if (isManual && isMountedRef.current) {
          setDeviceLoading(false);
        }
      }
    },
    []
  );

  const fetchCommands = useCallback(
    async (deviceId: string, userId: string, isManual = false) => {
      if (isManual && isMountedRef.current) {
        setHistoryLoading(true);
      }

      try {
        let data: LockCommand[] | null = null;
        let queryError: { message: string } | null = null;

        const primary = await supabase
          .from("commands")
          .select("id, action, status, created_at, failure_reason")
          .eq("device_id", deviceId)
          .eq("user_id", userId)
          .eq("action", "lock")
          .order("created_at", { ascending: false })
          .limit(10);

        data = (primary.data as LockCommand[] | null) ?? null;
        queryError = primary.error;

        // Fallback for pre-migration schema where failure_reason column does not exist yet
        if (queryError && queryError.message?.includes("failure_reason")) {
          const fallback = await supabase
            .from("commands")
            .select("id, action, status, created_at")
            .eq("device_id", deviceId)
            .eq("user_id", userId)
            .eq("action", "lock")
            .order("created_at", { ascending: false })
            .limit(10);

          data = (fallback.data as LockCommand[] | null) ?? null;
          queryError = fallback.error;
        }

        if (!isMountedRef.current) return;

        if (queryError) {
          setStatusError(`Could not load commands: ${queryError.message}`);
          return;
        }

        const list = (data ?? []) as LockCommand[];
        setCommandHistory(list);
        setLatestCommand(list.length > 0 ? list[0] : null);
        setStatusError("");
      } catch (err) {
        if (!isMountedRef.current) return;
        setStatusError(
          err instanceof Error ? err.message : "Could not retrieve command status."
        );
      } finally {
        if (isManual && isMountedRef.current) {
          setHistoryLoading(false);
        }
      }
    },
    []
  );

  // Initial load when user signs in
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    let isSubscribed = true;
    void fetchDevice(userId, true).then((loadedDev) => {
      if (!isSubscribed) return;
      if (loadedDev?.id) {
        void fetchCommands(loadedDev.id, userId, true);
      }
    });

    return () => {
      isSubscribed = false;
    };
  }, [session?.user?.id, fetchDevice, fetchCommands]);

  // Coordinated polling loop: single timer runs heartbeat + commands together
  useEffect(() => {
    if (!session?.user?.id || !device?.id) return;

    const userId = session.user.id;
    const deviceId = device.id;

    const poll = async () => {
      if (isPollingBusyRef.current || !isMountedRef.current) return;
      isPollingBusyRef.current = true;

      try {
        await Promise.all([
          fetchDevice(userId, false),
          fetchCommands(deviceId, userId, false),
        ]);
      } finally {
        isPollingBusyRef.current = false;
      }
    };

    const intervalId = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [session?.user?.id, device?.id, fetchDevice, fetchCommands]);

  // Heartbeat calculation helper
  const getHeartbeatState = () => {
    if (deviceLoading && !device) {
      return {
        status: "checking",
        badgeText: "CHECKING STATUS",
        detailText: "Contacting laptop agent...",
        color: "#fbbf24",
        bg: "rgba(251, 191, 36, 0.12)",
        border: "rgba(251, 191, 36, 0.3)",
        dotColor: "#fbbf24",
      };
    }

    if (!device?.last_seen_at) {
      return {
        status: "unknown",
        badgeText: "NO HEARTBEAT",
        detailText: "Agent not yet checked in",
        color: "#94a3b8",
        bg: "rgba(148, 163, 184, 0.12)",
        border: "rgba(148, 163, 184, 0.25)",
        dotColor: "#64748b",
      };
    }

    const timestamp = Date.parse(device.last_seen_at);
    if (isNaN(timestamp)) {
      return {
        status: "unknown",
        badgeText: "INVALID TIMESTAMP",
        detailText: "Malformed agent timestamp",
        color: "#94a3b8",
        bg: "rgba(148, 163, 184, 0.12)",
        border: "rgba(148, 163, 184, 0.25)",
        dotColor: "#64748b",
      };
    }

    const diffMs = now - timestamp;
    if (diffMs < 0 || diffMs < HEARTBEAT_FRESHNESS_MS) {
      const secondsAgo = Math.max(0, Math.floor(diffMs / 1000));
      return {
        status: "online",
        badgeText: "AGENT ONLINE",
        detailText: secondsAgo <= 2 ? "Live connection • active now" : `Heartbeat active • ${secondsAgo}s ago`,
        color: "#34d399",
        bg: "rgba(52, 211, 153, 0.12)",
        border: "rgba(52, 211, 153, 0.35)",
        dotColor: "#10b981",
      };
    }

    const minutesAgo = Math.floor(diffMs / 60000);
    const timeLabel =
      minutesAgo < 1
        ? `${Math.floor(diffMs / 1000)}s ago`
        : minutesAgo < 60
        ? `${minutesAgo}m ago`
        : `${Math.floor(minutesAgo / 60)}h ago`;

    return {
      status: "offline",
      badgeText: "AGENT OFFLINE",
      detailText: `Last seen ${timeLabel}`,
      color: "#f87171",
      bg: "rgba(248, 113, 113, 0.12)",
      border: "rgba(248, 113, 113, 0.35)",
      dotColor: "#ef4444",
    };
  };

  const heartbeat = getHeartbeatState();
  const isCommandActive =
    latestCommand?.status === "pending" || latestCommand?.status === "claimed";

  // Format date helper
  const formatTimestamp = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + " • " + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Auth actions
  async function handleSignIn() {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Enter your email and password.");
      return;
    }

    setAuthLoading(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        Alert.alert("Sign in failed", error.message);
      }
    } finally {
      if (isMountedRef.current) setAuthLoading(false);
    }
  }

  async function handleSignUp() {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Enter your email and password.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Password too short", "Use a password with at least 6 characters.");
      return;
    }

    setAuthLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        Alert.alert("Sign up failed", error.message);
        return;
      }

      if (!data.session) {
        Alert.alert(
          "Check your email",
          "Your account was created. Please verify your email, then sign in."
        );
      }
    } finally {
      if (isMountedRef.current) setAuthLoading(false);
    }
  }

  async function handleRegisterLaptop(laptopNameToRegister?: string) {
    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert("Not signed in", "Please sign in first.");
      return;
    }

    const nameToSubmit = (laptopNameToRegister ?? newLaptopName ?? "").trim();
    if (!nameToSubmit) {
      setAddDeviceError("Please provide a name for this laptop.");
      return;
    }

    if (nameToSubmit.length > 50) {
      setAddDeviceError("Laptop name must be 50 characters or fewer.");
      return;
    }

    setRegistering(true);
    setMessage("");
    setAddDeviceError("");

    try {
      const { data, error } = await supabase.functions.invoke(
        "register-laptop",
        {
          body: {
            name: nameToSubmit,
            platform: "windows",
          },
        }
      );

      if (error) {
        let errorMsg = error.message;
        if (error.context && typeof error.context.json === "function") {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) {
              errorMsg = errBody.error;
            }
          } catch {
            // keep error.message
          }
        }
        setAddDeviceError(errorMsg);
        return;
      }

      if (!data?.success || !data?.device) {
        setAddDeviceError(data?.error || "Registration failed. Please try again.");
        return;
      }

      // Successful registration
      const registeredDevice = data.device as Device;

      // Reset modal state
      setIsAddModalVisible(false);
      setNewLaptopName("");
      setAddDeviceError("");

      // Refresh devices list so new device is visible, and set selected device
      await fetchDevice(userId, true);
      setDevice(registeredDevice);

      // Safe user-facing feedback: Note that Windows-agent configuration is not implemented yet
      Alert.alert(
        "Laptop Registered",
        `"${registeredDevice.name}" has been registered successfully.\n\nNote: Automated Windows-agent provisioning is not implemented yet. The secure agent credential has been generated on the server.`
      );
      setMessage(`"${registeredDevice.name}" registered.`);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setAddDeviceError(errMsg);
    } finally {
      if (isMountedRef.current) setRegistering(false);
    }
  }

  async function handleLockLaptop() {
    if (!session?.access_token || !device?.id) {
      Alert.alert(
        "Unable to lock",
        "Please sign in and register your laptop first."
      );
      return;
    }

    if (isCommandActive) {
      Alert.alert(
        "Command already in progress",
        "A lock request is currently waiting for or being processed by the Windows agent. Please wait for it to complete."
      );
      return;
    }

    Alert.alert(
      "Confirm Remote Lock",
      "Are you sure you want to lock your Windows laptop workstation now?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Lock Workstation",
          style: "destructive",
          onPress: async () => {
            setLockSubmitting(true);
            setMessage("");

            try {
              const { data, error } = await supabase.functions.invoke(
                "request-lock",
                {
                  body: { device_id: device.id },
                }
              );

              if (error) throw error;

              if (!data?.success) {
                throw new Error(
                  data?.error || "Could not send the lock command."
                );
              }

              if (data.command && isMountedRef.current) {
                const newCmd = data.command as LockCommand;
                setLatestCommand(newCmd);
                setCommandHistory((prev) => [newCmd, ...prev.filter((c) => c.id !== newCmd.id)]);
              }

              Alert.alert(
                "Lock command dispatched",
                "The command was created securely in Supabase. Your Windows agent will execute it on its next check-in cycle."
              );

              void fetchCommands(device.id, session.user.id, false);
            } catch (err) {
              Alert.alert(
                "Lock request failed",
                err instanceof Error
                  ? err.message
                  : "An unexpected error occurred."
              );
            } finally {
              if (isMountedRef.current) setLockSubmitting(false);
            }
          },
        },
      ]
    );
  }

  async function handleManualRefresh() {
    if (!session?.user?.id || !device?.id) return;
    await Promise.all([
      fetchDevice(session.user.id, true),
      fetchCommands(device.id, session.user.id, true),
    ]);
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert("Sign out failed", error.message);
    } else {
      setDevice(null);
      setLatestCommand(null);
      setCommandHistory([]);
      setMessage("");
      setStatusError("");
    }
  }

  // Signed-in Dashboard
  if (session) {
    return (
      <ScrollView
        style={styles.screenBackground}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.consoleContainer}>
          {/* Top Security Header */}
          <View style={styles.topBar}>
            <View style={styles.brandRow}>
              <View style={styles.shieldBadge}>
                <Text style={styles.shieldIcon}>🛡️</Text>
              </View>
              <View>
                <Text style={styles.brandTitle}>LAPTOP LOCK</Text>
                <Text style={styles.brandSubtitle}>SECURITY COMMAND</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.headerSignOutBtn} onPress={handleSignOut}>
              <Text style={styles.headerSignOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>

          {/* User Account Bar */}
          <View style={styles.userBanner}>
            <View style={styles.userDot} />
            <Text style={styles.userEmailText} numberOfLines={1}>
              {session.user.email}
            </Text>
            <View style={styles.encryptedPill}>
              <Text style={styles.encryptedPillText}>TLS 1.3</Text>
            </View>
          </View>

          {/* Device Profile Card */}
          <View style={styles.deviceCard}>
            <View style={styles.deviceHeader}>
              <View style={styles.deviceAvatar}>
                <Text style={styles.deviceEmoji}>💻</Text>
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>
                  {device?.name ?? "Windows 11 Laptop"}
                </Text>
                <Text style={styles.deviceSub}>
                  {device ? "Primary Workstation • Windows x64" : "No device attached"}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.addLaptopHeaderBtn}
                onPress={() => {
                  setAddDeviceError("");
                  setNewLaptopName("");
                  setIsAddModalVisible(true);
                }}
              >
                <Text style={styles.addLaptopHeaderBtnText}>+ Add Laptop</Text>
              </TouchableOpacity>
            </View>

            {/* Multi-Device Selector Bar */}
            {deviceList.length > 1 && (
              <View style={styles.deviceSelectorContainer}>
                <Text style={styles.deviceSelectorLabel}>SWITCH WORKSTATION:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.deviceSelectorScroll}>
                  {deviceList.map((d) => {
                    const isSelected = device?.id === d.id;
                    return (
                      <TouchableOpacity
                        key={d.id}
                        style={[
                          styles.deviceTabPill,
                          isSelected && styles.deviceTabPillActive,
                        ]}
                        onPress={() => setDevice(d)}
                      >
                        <Text
                          style={[
                            styles.deviceTabPillText,
                            isSelected && styles.deviceTabPillTextActive,
                          ]}
                        >
                          💻 {d.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Add Laptop Modal */}
            <Modal
              visible={isAddModalVisible}
              transparent
              animationType="fade"
              onRequestClose={() => {
                if (!registering) setIsAddModalVisible(false);
              }}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>ADD NEW LAPTOP</Text>
                    <TouchableOpacity
                      onPress={() => {
                        if (!registering) setIsAddModalVisible(false);
                      }}
                      disabled={registering}
                    >
                      <Text style={styles.modalCloseIcon}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalSubtitle}>
                    Register a new Windows workstation to this account. A unique agent credential will be provisioned.
                  </Text>

                  <Text style={styles.fieldLabel}>LAPTOP NAME</Text>
                  <TextInput
                    style={styles.modernInput}
                    placeholder="e.g. Dell XPS 15, Surface Pro"
                    placeholderTextColor="#64748b"
                    value={newLaptopName}
                    onChangeText={setNewLaptopName}
                    autoCapitalize="words"
                    maxLength={50}
                    editable={!registering}
                  />

                  <View style={styles.platformBadgeRow}>
                    <Text style={styles.platformBadgeLabel}>PLATFORM</Text>
                    <View style={styles.platformBadge}>
                      <Text style={styles.platformBadgeText}>🪟 Windows (Default)</Text>
                    </View>
                  </View>

                  {!!addDeviceError && (
                    <View style={styles.modalErrorBox}>
                      <Text style={styles.modalErrorText}>{addDeviceError}</Text>
                    </View>
                  )}

                  <View style={styles.modalBtnRow}>
                    <TouchableOpacity
                      style={styles.modalCancelBtn}
                      onPress={() => setIsAddModalVisible(false)}
                      disabled={registering}
                    >
                      <Text style={styles.modalCancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.modalConfirmBtn,
                        registering && styles.btnDisabled,
                      ]}
                      onPress={() => void handleRegisterLaptop()}
                      disabled={registering}
                    >
                      {registering ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.modalConfirmBtnText}>Register Laptop</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>

            {deviceLoading && !device ? (
              <ActivityIndicator size="small" color="#38bdf8" style={styles.verticalSpacer} />
            ) : device ? (
              <>
                {/* Live Heartbeat Indicator */}
                <View
                  style={[
                    styles.heartbeatContainer,
                    {
                      backgroundColor: heartbeat.bg,
                      borderColor: heartbeat.border,
                    },
                  ]}
                >
                  <View style={styles.heartbeatStatusRow}>
                    <View style={[styles.pulseDot, { backgroundColor: heartbeat.dotColor }]} />
                    <Text style={[styles.heartbeatBadgeText, { color: heartbeat.color }]}>
                      {heartbeat.badgeText}
                    </Text>
                  </View>
                  <Text style={[styles.heartbeatDetailText, { color: heartbeat.color }]}>
                    {heartbeat.detailText}
                  </Text>
                </View>

                {/* Quick Diagnostics Chips */}
                <View style={styles.specsGrid}>
                  <View style={styles.specChip}>
                    <Text style={styles.specLabel}>PLATFORM</Text>
                    <Text style={styles.specValue}>Windows 11</Text>
                  </View>
                  <View style={styles.specChip}>
                    <Text style={styles.specLabel}>SECURITY</Text>
                    <Text style={styles.specValue}>SHA-256 Auth</Text>
                  </View>
                  <View style={styles.specChip}>
                    <Text style={styles.specLabel}>POLL INTERVAL</Text>
                    <Text style={styles.specValue}>5s Cycle</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.notRegisteredNotice}>
                No workstation is linked to this account yet. Click below to register your current PC.
              </Text>
            )}

            {!device && !deviceLoading && (
              <TouchableOpacity
                style={[styles.primaryActionBtn, registering && styles.btnDisabled]}
                onPress={() => {
                  setAddDeviceError("");
                  setNewLaptopName("Windows 11 Laptop");
                  setIsAddModalVisible(true);
                }}
                disabled={registering}
              >
                {registering ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryActionBtnText}>+ Register This Laptop</Text>
                )}
              </TouchableOpacity>
            )}

            {device && (
              <>
                {/* HERO LOCK ACTION STATION */}
                <View style={styles.lockStationCard}>
                  <View style={styles.lockStationHeader}>
                    <Text style={styles.stationTitle}>REMOTE LOCK ACTION</Text>
                    <Text style={styles.stationSub}>Instantly lock workstation session</Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.heroLockBtn,
                      (lockSubmitting || isCommandActive || heartbeat.status === "offline") &&
                        styles.heroLockBtnDisabled,
                    ]}
                    onPress={handleLockLaptop}
                    disabled={lockSubmitting || isCommandActive}
                    activeOpacity={0.8}
                  >
                    {lockSubmitting ? (
                      <ActivityIndicator size="large" color="#ffffff" />
                    ) : isCommandActive ? (
                      <View style={styles.heroLockBtnContent}>
                        <Text style={styles.heroLockBtnEmoji}>⏳</Text>
                        <Text style={styles.heroLockBtnText}>COMMAND IN PROGRESS</Text>
                        <Text style={styles.heroLockBtnSub}>Waiting for agent to finish...</Text>
                      </View>
                    ) : (
                      <View style={styles.heroLockBtnContent}>
                        <Text style={styles.heroLockBtnEmoji}>🔒</Text>
                        <Text style={styles.heroLockBtnText}>LOCK WORKSTATION</Text>
                        <Text style={styles.heroLockBtnSub}>Tap to lock Windows immediately</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  {isCommandActive && (
                    <View style={styles.inProgressBanner}>
                      <Text style={styles.inProgressBannerText}>
                        ⚠️ Command active. Duplicate lock submissions are temporarily locked out.
                      </Text>
                    </View>
                  )}

                  {heartbeat.status === "offline" && !isCommandActive && (
                    <Text style={styles.offlineWarningText}>
                      Notice: Agent is currently offline. Lock command will queue in pending state until agent resumes.
                    </Text>
                  )}
                </View>

                {/* LATEST STATUS MONITOR */}
                <View style={styles.monitorCard}>
                  <View style={styles.monitorHeaderRow}>
                    <Text style={styles.monitorTitle}>LATEST COMMAND MONITOR</Text>
                    <View style={styles.liveIndicator}>
                      <View style={styles.liveIndicatorDot} />
                      <Text style={styles.liveIndicatorText}>LIVE</Text>
                    </View>
                  </View>

                  {historyLoading && !latestCommand ? (
                    <ActivityIndicator color="#38bdf8" style={styles.verticalSpacer} />
                  ) : latestCommand ? (
                    <View style={styles.commandBanner}>
                      <View style={styles.commandStatusHeader}>
                        <View
                          style={[
                            styles.statusPill,
                            latestCommand.status === "completed" && styles.pillCompleted,
                            latestCommand.status === "failed" && styles.pillFailed,
                            latestCommand.status === "claimed" && styles.pillClaimed,
                            latestCommand.status === "pending" && styles.pillPending,
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusPillText,
                              latestCommand.status === "completed" && styles.pillTextCompleted,
                              latestCommand.status === "failed" && styles.pillTextFailed,
                              latestCommand.status === "claimed" && styles.pillTextClaimed,
                              latestCommand.status === "pending" && styles.pillTextPending,
                            ]}
                          >
                            {latestCommand.status === "completed"
                              ? "✓ LOCK COMPLETED"
                              : latestCommand.status === "failed"
                              ? "✕ LOCK FAILED"
                              : latestCommand.status === "claimed"
                              ? "● IN PROGRESS (CLAIMED)"
                              : "◷ PENDING EXECUTION"}
                          </Text>
                        </View>

                        <Text style={styles.commandTime}>{formatTimestamp(latestCommand.created_at)}</Text>
                      </View>

                      {latestCommand.status === "claimed" && (
                        <Text style={styles.commandNote}>
                          Agent received the lock dispatch. Windows workstation is executing the command.
                        </Text>
                      )}

                      {latestCommand.status === "pending" && (
                        <Text style={styles.commandNote}>
                          Command enqueued. Waiting for Windows agent to poll the server.
                        </Text>
                      )}

                      {latestCommand.status === "failed" && latestCommand.failure_reason && (
                        <View style={styles.failureBox}>
                          <Text style={styles.failureBoxTitle}>FAILURE REASON</Text>
                          <Text style={styles.failureBoxMsg}>{latestCommand.failure_reason}</Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.emptyFeedText}>No lock commands dispatched yet.</Text>
                  )}

                  {!!statusError && <Text style={styles.errorBannerText}>{statusError}</Text>}
                </View>

                {/* COMMAND AUDIT LOG / TIMELINE */}
                <View style={styles.historyCard}>
                  <View style={styles.historyCardHeader}>
                    <Text style={styles.historyTitle}>AUDIT LOG / HISTORY</Text>
                    {historyLoading && <ActivityIndicator size="small" color="#38bdf8" />}
                  </View>

                  {commandHistory.length === 0 ? (
                    <Text style={styles.emptyFeedText}>Audit trail is currently empty.</Text>
                  ) : (
                    commandHistory.map((cmd, idx) => (
                      <View
                        key={cmd.id}
                        style={[styles.historyRow, idx === 0 && styles.historyRowFirst]}
                      >
                        <View style={styles.historyLeft}>
                          <View
                            style={[
                              styles.historyDot,
                              cmd.status === "completed" && styles.dotCompleted,
                              cmd.status === "failed" && styles.dotFailed,
                              cmd.status === "claimed" && styles.dotClaimed,
                              cmd.status === "pending" && styles.dotPending,
                            ]}
                          />
                          <View>
                            <Text style={styles.historyActionName}>
                              {cmd.status === "completed"
                                ? "Lock Executed"
                                : cmd.status === "failed"
                                ? "Lock Aborted"
                                : cmd.status === "claimed"
                                ? "Command In Progress"
                                : "Pending Dispatch"}
                            </Text>
                            <Text style={styles.historyTimestamp}>
                              {formatTimestamp(cmd.created_at)}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={[
                            styles.historyStatusBadge,
                            cmd.status === "completed" && styles.badgeSuccessBorder,
                            cmd.status === "failed" && styles.badgeDangerBorder,
                            cmd.status === "claimed" && styles.badgeClaimedBorder,
                            cmd.status === "pending" && styles.badgePendingBorder,
                          ]}
                        >
                          <Text
                            style={[
                              styles.historyBadgeLabel,
                              cmd.status === "completed" && styles.textCompleted,
                              cmd.status === "failed" && styles.textFailed,
                              cmd.status === "claimed" && styles.textClaimed,
                              cmd.status === "pending" && styles.textPending,
                            ]}
                          >
                            {cmd.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}

                  <View style={styles.historyFooter}>
                    <Text style={styles.footerNoteText}>
                      Auto-synchronizes every 4 seconds • Showing recent 10 records
                    </Text>
                  </View>
                </View>

                {/* Quick Refresh Button */}
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={handleManualRefresh}
                  disabled={historyLoading || deviceLoading || lockSubmitting}
                  activeOpacity={0.7}
                >
                  <Text style={styles.refreshBtnText}>
                    {historyLoading || deviceLoading ? "Syncing..." : "↻ Manual Sync"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {!!message && <Text style={styles.systemMessage}>{message}</Text>}

          <View style={styles.systemFooter}>
            <Text style={styles.systemFooterText}>
              End-to-End Encrypted Remote Workstation Controller
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  // Signed-out Authentication Screen
  return (
    <ScrollView
      style={styles.screenBackground}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.consoleContainer}>
        {/* Auth Brand Header */}
        <View style={styles.authBrandCard}>
          <View style={styles.authLogoWrap}>
            <Text style={styles.authLogoIcon}>🔒</Text>
          </View>
          <Text style={styles.authMainTitle}>LAPTOP REMOTE LOCK</Text>
          <Text style={styles.authSubTitle}>Secure Workstation Defense System</Text>
        </View>

        {/* Auth Form Card */}
        <View style={styles.authFormBox}>
          {/* Auth Tab Switcher */}
          <View style={styles.authTabs}>
            <TouchableOpacity
              style={[styles.authTab, authMode === "signin" && styles.authTabActive]}
              onPress={() => setAuthMode("signin")}
            >
              <Text
                style={[
                  styles.authTabText,
                  authMode === "signin" && styles.authTabTextActive,
                ]}
              >
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.authTab, authMode === "signup" && styles.authTabActive]}
              onPress={() => setAuthMode("signup")}
            >
              <Text
                style={[
                  styles.authTabText,
                  authMode === "signup" && styles.authTabTextActive,
                ]}
              >
                Create Account
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.formFields}>
            <Text style={styles.fieldLabel}>ACCOUNT EMAIL</Text>
            <TextInput
              style={styles.modernInput}
              placeholder="operator@company.com"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <TextInput
              style={styles.modernInput}
              placeholder="••••••••••••"
              placeholderTextColor="#64748b"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          {authMode === "signin" ? (
            <TouchableOpacity
              style={[styles.authSubmitBtn, authLoading && styles.btnDisabled]}
              onPress={handleSignIn}
              disabled={authLoading}
              activeOpacity={0.8}
            >
              {authLoading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.authSubmitBtnText}>Authenticate & Enter →</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.authSubmitBtn, styles.signupBtnBg, authLoading && styles.btnDisabled]}
              onPress={handleSignUp}
              disabled={authLoading}
              activeOpacity={0.8}
            >
              {authLoading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.authSubmitBtnText}>Register Account →</Text>
              )}
            </TouchableOpacity>
          )}

          <Text style={styles.authHintText}>
            Protected by Supabase Auth with bcrypt hashing and encrypted sessions.
          </Text>
        </View>

        {!!message && <Text style={styles.systemMessage}>{message}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenBackground: {
    flex: 1,
    backgroundColor: "#090d16",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  consoleContainer: {
    width: "100%",
    maxWidth: 520,
    alignItems: "center",
  },
  topBar: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  shieldBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  shieldIcon: {
    fontSize: 18,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#f8fafc",
    letterSpacing: 1.2,
  },
  brandSubtitle: {
    fontSize: 9,
    fontWeight: "700",
    color: "#38bdf8",
    letterSpacing: 1.5,
  },
  headerSignOutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(244, 63, 94, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.25)",
  },
  headerSignOutText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#f43f5e",
    letterSpacing: 0.5,
  },
  userBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    gap: 8,
  },
  userDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34d399",
  },
  userEmailText: {
    flex: 1,
    fontSize: 12,
    color: "#cbd5e1",
    fontWeight: "500",
  },
  encryptedPill: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  encryptedPillText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.8,
  },
  deviceCard: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
    ...Platform.select({
      web: {
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
      },
      default: {
        elevation: 6,
      },
    }),
  },
  deviceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  deviceAvatar: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(56, 189, 248, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  deviceEmoji: {
    fontSize: 26,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#f8fafc",
    letterSpacing: -0.3,
  },
  deviceSub: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
    fontWeight: "500",
  },
  heartbeatContainer: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heartbeatStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heartbeatBadgeText: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  heartbeatDetailText: {
    fontSize: 11,
    fontWeight: "600",
  },
  specsGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  specChip: {
    flex: 1,
    backgroundColor: "#162032",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  specLabel: {
    fontSize: 8,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  specValue: {
    fontSize: 11,
    fontWeight: "700",
    color: "#cbd5e1",
  },
  lockStationCard: {
    width: "100%",
    backgroundColor: "#161f30",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  lockStationHeader: {
    alignItems: "center",
    marginBottom: 14,
  },
  stationTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: "#f43f5e",
    letterSpacing: 1.2,
  },
  stationSub: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  heroLockBtn: {
    width: "100%",
    backgroundColor: "#e11d48",
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      web: {
        boxShadow: "0 6px 20px rgba(225, 29, 72, 0.4)",
        cursor: "pointer",
      },
    }),
  },
  heroLockBtnDisabled: {
    opacity: 0.5,
  },
  heroLockBtnContent: {
    alignItems: "center",
  },
  heroLockBtnEmoji: {
    fontSize: 26,
    marginBottom: 4,
  },
  heroLockBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  heroLockBtnSub: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  inProgressBanner: {
    marginTop: 10,
    backgroundColor: "rgba(251, 191, 36, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.3)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    width: "100%",
  },
  inProgressBannerText: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 15,
  },
  offlineWarningText: {
    color: "#94a3b8",
    fontSize: 10,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 14,
  },
  monitorCard: {
    width: "100%",
    backgroundColor: "#161f30",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    padding: 14,
    marginBottom: 16,
  },
  monitorHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  monitorTitle: {
    fontSize: 10,
    fontWeight: "900",
    color: "#94a3b8",
    letterSpacing: 1,
  },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(56, 189, 248, 0.1)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  liveIndicatorDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#38bdf8",
  },
  liveIndicatorText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#38bdf8",
    letterSpacing: 0.8,
  },
  commandBanner: {
    backgroundColor: "#101623",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  commandStatusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  pillCompleted: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  pillFailed: {
    backgroundColor: "rgba(244, 63, 94, 0.15)",
    borderColor: "rgba(244, 63, 94, 0.35)",
  },
  pillClaimed: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: "rgba(56, 189, 248, 0.35)",
  },
  pillPending: {
    backgroundColor: "rgba(251, 191, 36, 0.15)",
    borderColor: "rgba(251, 191, 36, 0.35)",
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  pillTextCompleted: {
    color: "#34d399",
  },
  pillTextFailed: {
    color: "#f87171",
  },
  pillTextClaimed: {
    color: "#38bdf8",
  },
  pillTextPending: {
    color: "#fbbf24",
  },
  commandTime: {
    fontSize: 10,
    color: "#64748b",
    fontWeight: "600",
  },
  commandNote: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 8,
    lineHeight: 16,
  },
  failureBox: {
    marginTop: 8,
    backgroundColor: "rgba(244, 63, 94, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.25)",
    borderRadius: 8,
    padding: 8,
  },
  failureBoxTitle: {
    fontSize: 8,
    fontWeight: "900",
    color: "#f43f5e",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  failureBoxMsg: {
    fontSize: 11,
    color: "#fca5a5",
    fontWeight: "500",
  },
  emptyFeedText: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
    paddingVertical: 10,
  },
  errorBannerText: {
    fontSize: 11,
    color: "#f43f5e",
    textAlign: "center",
    marginTop: 6,
  },
  historyCard: {
    width: "100%",
    backgroundColor: "#161f30",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    padding: 14,
    marginBottom: 14,
  },
  historyCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  historyTitle: {
    fontSize: 10,
    fontWeight: "900",
    color: "#94a3b8",
    letterSpacing: 1,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.05)",
  },
  historyRowFirst: {
    borderTopWidth: 0,
  },
  historyLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  historyDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dotCompleted: {
    backgroundColor: "#10b981",
  },
  dotFailed: {
    backgroundColor: "#ef4444",
  },
  dotClaimed: {
    backgroundColor: "#38bdf8",
  },
  dotPending: {
    backgroundColor: "#f59e0b",
  },
  historyActionName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#f1f5f9",
  },
  historyTimestamp: {
    fontSize: 10,
    color: "#64748b",
    marginTop: 2,
  },
  historyStatusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeSuccessBorder: {
    borderColor: "rgba(16, 185, 129, 0.4)",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  badgeDangerBorder: {
    borderColor: "rgba(244, 63, 94, 0.4)",
    backgroundColor: "rgba(244, 63, 94, 0.08)",
  },
  badgeClaimedBorder: {
    borderColor: "rgba(56, 189, 248, 0.4)",
    backgroundColor: "rgba(56, 189, 248, 0.08)",
  },
  badgePendingBorder: {
    borderColor: "rgba(251, 191, 36, 0.4)",
    backgroundColor: "rgba(251, 191, 36, 0.08)",
  },
  historyBadgeLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  textCompleted: {
    color: "#34d399",
  },
  textFailed: {
    color: "#f87171",
  },
  textClaimed: {
    color: "#38bdf8",
  },
  textPending: {
    color: "#fbbf24",
  },
  historyFooter: {
    marginTop: 10,
    alignItems: "center",
  },
  footerNoteText: {
    fontSize: 9,
    color: "#64748b",
    letterSpacing: 0.3,
  },
  refreshBtn: {
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 4,
  },
  refreshBtnText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  primaryActionBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    marginTop: 10,
    width: "100%",
  },
  primaryActionBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  notRegisteredNotice: {
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "center",
    marginVertical: 12,
    lineHeight: 18,
  },
  verticalSpacer: {
    marginVertical: 12,
  },
  systemMessage: {
    color: "#94a3b8",
    fontSize: 11,
    textAlign: "center",
    marginTop: 12,
  },
  systemFooter: {
    marginTop: 16,
    paddingVertical: 6,
  },
  systemFooterText: {
    fontSize: 10,
    color: "#475569",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  authBrandCard: {
    alignItems: "center",
    marginBottom: 24,
  },
  authLogoWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: "rgba(56, 189, 248, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  authLogoIcon: {
    fontSize: 28,
  },
  authMainTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#f8fafc",
    letterSpacing: 1.5,
    textAlign: "center",
  },
  authSubTitle: {
    fontSize: 12,
    color: "#94a3b8",
    letterSpacing: 0.8,
    marginTop: 4,
    textAlign: "center",
  },
  authFormBox: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  authTabs: {
    flexDirection: "row",
    backgroundColor: "#161f30",
    borderRadius: 10,
    padding: 3,
    marginBottom: 18,
  },
  authTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  authTabActive: {
    backgroundColor: "#2563eb",
  },
  authTabText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8",
  },
  authTabTextActive: {
    color: "#ffffff",
  },
  formFields: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 1,
    marginBottom: 6,
  },
  modernInput: {
    backgroundColor: "#161f30",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#f8fafc",
    marginBottom: 14,
  },
  authSubmitBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
    ...Platform.select({
      web: {
        boxShadow: "0 4px 14px rgba(37, 99, 235, 0.35)",
        cursor: "pointer",
      },
    }),
  },
  signupBtnBg: {
    backgroundColor: "#059669",
  },
  authSubmitBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  authHintText: {
    fontSize: 10,
    color: "#64748b",
    textAlign: "center",
    marginTop: 14,
    lineHeight: 14,
  },
  addLaptopHeaderBtn: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  addLaptopHeaderBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38bdf8",
    letterSpacing: 0.5,
  },
  deviceSelectorContainer: {
    width: "100%",
    marginBottom: 14,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  deviceSelectorLabel: {
    fontSize: 8,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 1,
    marginBottom: 8,
  },
  deviceSelectorScroll: {
    flexDirection: "row",
  },
  deviceTabPill: {
    backgroundColor: "#162032",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  deviceTabPillActive: {
    backgroundColor: "rgba(37, 99, 235, 0.25)",
    borderColor: "#3b82f6",
  },
  deviceTabPillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94a3b8",
  },
  deviceTabPillTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#111827",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#f8fafc",
    letterSpacing: 1,
  },
  modalCloseIcon: {
    fontSize: 16,
    fontWeight: "700",
    color: "#94a3b8",
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 17,
    marginBottom: 16,
  },
  platformBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  platformBadgeLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 1,
  },
  platformBadge: {
    backgroundColor: "#162032",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  platformBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#cbd5e1",
  },
  modalErrorBox: {
    backgroundColor: "rgba(244, 63, 94, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.3)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  modalErrorText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  modalCancelBtnText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
  },
  modalConfirmBtn: {
    flex: 1.5,
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalConfirmBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
});
