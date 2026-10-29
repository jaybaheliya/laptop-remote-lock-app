import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { RemoteFeatures } from "../components/remote-features";

type Device = {
  id: string;
  name: string;
  platform: string;
  last_seen_at: string | null;
  battery_level?: number | null;
  is_charging?: boolean | null;
  power_online?: boolean | null;
  network_name?: string | null;
  network_type?: string | null;
  local_ip?: string | null;
  disk_free_gb?: number | null;
  disk_total_gb?: number | null;
  memory_used_gb?: number | null;
  memory_total_gb?: number | null;
  rdp_host?: string | null;
  rdp_port?: number | null;
};

type LockCommand = {
  id: string;
  action: string;
  status: "pending" | "claimed" | "completed" | "failed" | string;
  created_at: string;
  failure_reason?: string | null;
};

type ScreenshotItem = {
  id: string;
  device_id: string;
  image_data: string;
  created_at: string;
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

  // Pairing Credentials modal state
  const [isPairingModalVisible, setIsPairingModalVisible] = useState(false);
  const [pairedDeviceName, setPairedDeviceName] = useState("");
  const [pairingKey, setPairingKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [storedPairingKeys, setStoredPairingKeys] = useState<{ [deviceId: string]: string }>({});
  const [deletingLaptop, setDeletingLaptop] = useState(false);

  const [latestCommand, setLatestCommand] = useState<LockCommand | null>(null);
  const [commandHistory, setCommandHistory] = useState<LockCommand[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState<
    "lock" | "sleep" | "shutdown" | "screenshot" | "unlock" | null
  >(null);
  const lockSubmitting = actionSubmitting !== null;
  const [latestScreenshot, setLatestScreenshot] = useState<ScreenshotItem | null>(null);
  const [screenshotModalVisible, setScreenshotModalVisible] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [rdpSettingsVisible, setRdpSettingsVisible] = useState(false);
  const [rdpHostInput, setRdpHostInput] = useState("");
  const [rdpPortInput, setRdpPortInput] = useState("3389");
  const [rdpSaving, setRdpSaving] = useState(false);

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
        const telemetryResponse = await supabase
          .from("devices")
          .select("id, name, platform, last_seen_at, battery_level, is_charging, power_online, rdp_host, rdp_port, network_name, network_type, local_ip, disk_free_gb, disk_total_gb, memory_used_gb, memory_total_gb")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        let deviceData = telemetryResponse.data as Device[] | null;
        let deviceErrorMessage = telemetryResponse.error?.message ?? null;

        // Keep the existing controller usable until the telemetry migration is applied.
        if (telemetryResponse.error && /column .* does not exist|schema cache/i.test(telemetryResponse.error.message)) {
          const legacyResponse = await supabase
            .from("devices")
            .select("id, name, platform, last_seen_at, battery_level, is_charging, power_online, rdp_host, rdp_port")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
          deviceData = legacyResponse.data as Device[] | null;
          deviceErrorMessage = legacyResponse.error?.message ?? null;
        }

        if (!isMountedRef.current) return null;

        if (deviceErrorMessage) {
          setMessage(`Could not load laptop: ${deviceErrorMessage}`);
          return null;
        }

        const devices = deviceData ?? [];
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
          .in("action", ["lock", "sleep", "shutdown", "screenshot", "unlock", "panic", "display_message", "task_list", "end_task", "refresh_status", "save_note", "screen_record", "rename_recording"])
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
            .in("action", ["lock", "sleep", "shutdown", "screenshot", "unlock", "screen_record", "rename_recording"])
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

  const fetchScreenshot = useCallback(async (deviceId: string, userId: string) => {
    try {
      const { data, error } = await supabase
        .from("screenshots")
        .select("id, device_id, image_data, created_at")
        .eq("device_id", deviceId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data && isMountedRef.current) {
        setLatestScreenshot(data as ScreenshotItem);
      }
    } catch {
      // Ignore background fetch error
    }
  }, []);

  // Initial load when user signs in
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    let isSubscribed = true;
    void fetchDevice(userId, true).then((loadedDev) => {
      if (!isSubscribed) return;
      if (loadedDev?.id) {
        void fetchCommands(loadedDev.id, userId, true);
        void fetchScreenshot(loadedDev.id, userId);
      }
    });

    return () => {
      isSubscribed = false;
    };
  }, [session?.user?.id, fetchDevice, fetchCommands, fetchScreenshot]);

  // Coordinated polling loop: single timer runs heartbeat + commands + screenshot together
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
          fetchScreenshot(deviceId, userId),
        ]);
      } finally {
        isPollingBusyRef.current = false;
      }
    };

    const intervalId = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [session?.user?.id, device?.id, fetchDevice, fetchCommands, fetchScreenshot]);

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
        setMessage(error.message);
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
        setMessage(error.message);
        Alert.alert("Sign up failed", error.message);
        return;
      }

      if (!data.session) {
        setMessage("Account created! Please check your email to confirm your account before signing in.");
        Alert.alert(
          "Check your email",
          "Your account was created. Please verify your email, then sign in."
        );
      } else {
        setMessage("Account created and signed in!");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "An unexpected sign up error occurred.");
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
      const returnedToken = typeof data.token === "string" ? data.token : "";

      // Reset add modal state
      setIsAddModalVisible(false);
      setNewLaptopName("");
      setAddDeviceError("");

      // Construct portable configuration object
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
      const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

      let encodedPairingKey = "";
      if (returnedToken && registeredDevice?.id) {
        const configPayload = {
          deviceId: registeredDevice.id,
          supabaseUrl,
          supabasePublishableKey,
          token: returnedToken,
          pollIntervalMs: 5000,
          testMode: false,
        };
        try {
          const jsonStr = JSON.stringify(configPayload);
          if (typeof btoa === "function") {
            encodedPairingKey = btoa(unescape(encodeURIComponent(jsonStr)));
          } else {
            // Pure JS base64 fallback for environments without global btoa
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
            let output = "";
            const utf8Str = unescape(encodeURIComponent(jsonStr));
            for (let i = 0; i < utf8Str.length; i += 3) {
              const b1 = utf8Str.charCodeAt(i);
              const b2 = utf8Str.charCodeAt(i + 1);
              const b3 = utf8Str.charCodeAt(i + 2);
              output += chars.charAt(b1 >> 2);
              output += chars.charAt(((b1 & 3) << 4) | (b2 >> 4));
              output += isNaN(b2) ? "=" : chars.charAt(((b2 & 15) << 2) | (b3 >> 6));
              output += isNaN(b3) ? "=" : chars.charAt(b3 & 63);
            }
            encodedPairingKey = output;
          }
        } catch {
          encodedPairingKey = JSON.stringify(configPayload);
        }
      }

      // Refresh devices list so new device is visible, and set selected device
      await fetchDevice(userId, true);
      setDevice(registeredDevice);

      if (encodedPairingKey) {
        setStoredPairingKeys((prev) => ({
          ...prev,
          [registeredDevice.id]: encodedPairingKey,
        }));
        setPairedDeviceName(registeredDevice.name);
        setPairingKey(encodedPairingKey);
        setCopiedKey(false);
        setIsPairingModalVisible(true);
      } else {
        Alert.alert(
          "Laptop Registered",
          `"${registeredDevice.name}" has been registered successfully.`
        );
      }
      setMessage(`"${registeredDevice.name}" registered.`);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setAddDeviceError(errMsg);
    } finally {
      if (isMountedRef.current) setRegistering(false);
    }
  }

  async function handleDeleteLaptop(laptopToDelete: Device) {
    const userId = session?.user?.id;
    if (!userId) return;

    const performDelete = async () => {
      setDeletingLaptop(true);
      setMessage("");

      try {
        // Delete related commands first to respect foreign key constraints
        await supabase
          .from("commands")
          .delete()
          .eq("device_id", laptopToDelete.id)
          .eq("user_id", userId);

        // Delete device credentials
        await supabase
          .from("device_agent_credentials")
          .delete()
          .eq("device_id", laptopToDelete.id)
          .eq("user_id", userId);

        // Delete device record
        const { error } = await supabase
          .from("devices")
          .delete()
          .eq("id", laptopToDelete.id)
          .eq("user_id", userId);

        if (error) {
          Alert.alert("Delete failed", error.message);
          return;
        }

        // Clean up locally stored pairing key if any
        setStoredPairingKeys((prev) => {
          const updated = { ...prev };
          delete updated[laptopToDelete.id];
          return updated;
        });

        // Refresh devices list
        await fetchDevice(userId, true);
        Alert.alert(
          "Laptop Removed",
          `"${laptopToDelete.name}" has been removed from your dashboard.`
        );
        setMessage(`"${laptopToDelete.name}" removed.`);
      } catch (err) {
        Alert.alert(
          "Error",
          err instanceof Error ? err.message : "Could not delete laptop."
        );
      } finally {
        if (isMountedRef.current) setDeletingLaptop(false);
      }
    };

    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm(
          `Are you sure you want to remove "${laptopToDelete.name}"? This workstation will no longer be able to receive lock commands.`
        )
      ) {
        void performDelete();
      }
    } else {
      Alert.alert(
        "Remove Laptop",
        `Are you sure you want to remove "${laptopToDelete.name}"? This workstation will no longer be able to receive lock commands.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => void performDelete(),
          },
        ]
      );
    }
  }

  async function executeRemoteAction(
    action: "lock" | "sleep" | "shutdown" | "screenshot" | "unlock"
  ) {
    if (!session?.access_token || !device?.id) {
      Alert.alert(
        "Unable to execute command",
        "Please sign in and select a registered laptop first."
      );
      return;
    }

    if (isCommandActive) {
      Alert.alert(
        "Command already in progress",
        `A command is currently waiting for or being processed by the Windows agent (${latestCommand?.action?.toUpperCase() || "PENDING"}). Please wait for it to complete.`
      );
      return;
    }

    setActionSubmitting(action);
    setMessage("");

    try {
      const { data, error } = await supabase.functions.invoke(
        "request-lock",
        {
          body: { device_id: device.id, action },
        }
      );

      if (error) throw error;

      if (!data?.success) {
        throw new Error(
          data?.error || `Could not send the ${action} command.`
        );
      }

      if (data.command && isMountedRef.current) {
        const newCmd = data.command as LockCommand;
        setLatestCommand(newCmd);
        setCommandHistory((prev) => [newCmd, ...prev.filter((c) => c.id !== newCmd.id)]);
      }

      const actionSuccessMsg: Record<string, string> = {
        lock: "Lock command dispatched! Windows workstation will lock shortly.",
        sleep: "Sleep command dispatched! Windows workstation is entering sleep mode.",
        shutdown: "Shutdown command dispatched! Windows workstation will shut down in 10 seconds.",
        screenshot: "Screenshot command dispatched! Windows agent is capturing your desktop...",
        unlock: "Wake command dispatched! Windows sign-in remains under local user control.",
      };

      const msg = actionSuccessMsg[action] || `${action} dispatched!`;
      setMessage(msg);
      if (Platform.OS !== "web") {
        Alert.alert("Command Dispatched", msg);
      }

      void fetchCommands(device.id, session.user.id, false);

      if (action === "screenshot") {
        setTimeout(() => {
          if (isMountedRef.current) {
            void fetchScreenshot(device.id, session.user.id);
          }
        }, 3500);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setMessage(errMsg);
      Alert.alert(`${action.toUpperCase()} request failed`, errMsg);
    } finally {
      if (isMountedRef.current) setActionSubmitting(null);
    }
  }

  function handleLockLaptop() {
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm("Are you sure you want to lock your Windows laptop workstation now?")
      ) {
        void executeRemoteAction("lock");
      }
    } else {
      Alert.alert(
        "Confirm Remote Lock",
        "Are you sure you want to lock your Windows laptop workstation now?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Lock Workstation",
            style: "destructive",
            onPress: () => void executeRemoteAction("lock"),
          },
        ]
      );
    }
  }

  function handleSleepLaptop() {
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm(
          `Put "${device?.name || "your workstation"}" into low-power sleep mode now?\n\nThe Windows session will suspend immediately.`
        )
      ) {
        void executeRemoteAction("sleep");
      }
    } else {
      Alert.alert(
        "Confirm Remote Sleep",
        `Put "${device?.name || "your workstation"}" into low-power sleep mode now? The Windows session will suspend immediately.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sleep PC",
            style: "default",
            onPress: () => void executeRemoteAction("sleep"),
          },
        ]
      );
    }
  }

  function handleShutdownLaptop() {
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm(
          `⚠️ WARNING: Are you sure you want to SHUT DOWN "${device?.name || "your workstation"}"?\n\n• Windows will close open applications and power off in 10 seconds.\n• Unsaved work may be lost.\n• You will not be able to connect remotely until someone powers the PC back on.`
        )
      ) {
        void executeRemoteAction("shutdown");
      }
    } else {
      Alert.alert(
        "⚠️ Confirm Remote Shutdown",
        `Are you sure you want to shut down "${device?.name || "your workstation"}"?\n\nWindows will power off in 10 seconds. Unsaved work may be lost, and the PC cannot be woken remotely without physical power-on.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Shut Down PC",
            style: "destructive",
            onPress: () => void executeRemoteAction("shutdown"),
          },
        ]
      );
    }
  }

  async function handleManualRefresh() {
    if (!session?.user?.id || !device?.id) return;
    await Promise.all([
      fetchDevice(session.user.id, true),
      fetchCommands(device.id, session.user.id, true),
      fetchScreenshot(device.id, session.user.id),
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

  function openRdpSettings() {
    setRdpHostInput(device?.rdp_host ?? "");
    setRdpPortInput(String(device?.rdp_port ?? 3389));
    setRdpSettingsVisible(true);
  }

  async function handleSaveRdpSettings() {
    if (!session?.user?.id || !device?.id) return;
    const host = rdpHostInput.trim();
    const port = Number(rdpPortInput.trim());
    const validHostname = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
    if (host && !validHostname.test(host)) {
      Alert.alert("Invalid address", "Enter a PC name, DNS name, or IPv4 address without a scheme or port.");
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      Alert.alert("Invalid port", "Enter a port number from 1 to 65535.");
      return;
    }

    setRdpSaving(true);
    try {
      const { error } = await supabase
        .from("devices")
        .update({ rdp_host: host || null, rdp_port: port })
        .eq("id", device.id)
        .eq("user_id", session.user.id);
      if (error) throw error;
      const updatedDevice = { ...device, rdp_host: host || null, rdp_port: port };
      setDevice(updatedDevice);
      setDeviceList((items) => items.map((item) => item.id === device.id ? updatedDevice : item));
      setRdpSettingsVisible(false);
    } catch (error) {
      Alert.alert("Could not save", error instanceof Error ? error.message : "Remote Desktop settings were not saved.");
    } finally {
      setRdpSaving(false);
    }
  }

  async function handleConnectRemoteDesktop() {
    if (!device?.rdp_host) {
      openRdpSettings();
      return;
    }
    const address = `${device.rdp_host}:${device.rdp_port ?? 3389}`;
    if (Platform.OS === "web") {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(address);
        }
      } catch {
        // The address is also shown below if clipboard access is unavailable.
      }
      Alert.alert(
        "Open your Remote Desktop client",
        `Connect to ${address} in Microsoft Remote Desktop or Windows App. This app does not send or store your Windows sign-in password.`,
      );
      return;
    }
    const rdpUri = `rdp://full%20address=s:${device.rdp_host}:${device.rdp_port ?? 3389}`;
    try {
      await Linking.openURL(rdpUri);
    } catch {
      Alert.alert(
        "Remote Desktop app not found",
        `Install Microsoft's Remote Desktop client or Windows App, then connect to ${address}.`,
      );
    }
  }

  // Signed-in Dashboard
  if (session) {
    return (
      <SafeAreaView style={styles.safeAreaContainer} edges={["top", "left", "right", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor="#090d16" />
        <ScrollView
          style={styles.screenBackground}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
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

            {/* Pairing Key Modal */}
            <Modal
              visible={isPairingModalVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setIsPairingModalVisible(false)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>WORKSTATION PAIRING KEY</Text>
                    <TouchableOpacity
                      onPress={() => setIsPairingModalVisible(false)}
                    >
                      <Text style={styles.modalCloseIcon}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalSubtitle}>
                    &quot;{pairedDeviceName}&quot; is registered! Paste this one-time pairing key into the Windows installer or save it to your agent config.
                  </Text>

                  <Text style={styles.fieldLabel}>ONE-TIME PAIRING KEY</Text>
                  <View style={styles.pairingKeyBox}>
                    <Text style={styles.pairingKeyText} numberOfLines={4} ellipsizeMode="middle" selectable>
                      {pairingKey}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.copyKeyBtn,
                      copiedKey && styles.copyKeyBtnSuccess,
                    ]}
                    onPress={() => {
                      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
                        navigator.clipboard.writeText(pairingKey);
                        setCopiedKey(true);
                      } else {
                        setCopiedKey(true);
                      }
                    }}
                  >
                    <Text style={styles.copyKeyBtnText}>
                      {copiedKey ? "✓ Copied to Clipboard!" : "📋 Copy Pairing Key"}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.pairingInstructionsBox}>
                    <Text style={styles.pairingInstructionsHeader}>NEXT STEPS ON YOUR PC:</Text>
                    <Text style={styles.pairingInstructionStep}>
                      1. Run the Laptop Remote Lock Agent Windows installer.
                    </Text>
                    <Text style={styles.pairingInstructionStep}>
                      2. When prompted, paste this Pairing Key.
                    </Text>
                    <Text style={styles.pairingInstructionStep}>
                      3. The agent will connect automatically on Windows sign-in.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.modalDoneBtn}
                    onPress={() => setIsPairingModalVisible(false)}
                  >
                    <Text style={styles.modalDoneBtnText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>

            {/* Fullscreen Screenshot Modal */}
            <Modal
              visible={screenshotModalVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setScreenshotModalVisible(false)}
            >
              <View style={styles.fullscreenModalOverlay}>
                <View style={styles.fullscreenModalHeader}>
                  <Text style={styles.fullscreenModalTitle}>📸 FULL DESKTOP SNAPSHOT</Text>
                  <TouchableOpacity
                    onPress={() => setScreenshotModalVisible(false)}
                    style={styles.fullscreenCloseBtn}
                  >
                    <Text style={styles.fullscreenCloseBtnText}>✕ Close</Text>
                  </TouchableOpacity>
                </View>

                {latestScreenshot && (
                  <View style={styles.fullscreenImageContainer}>
                    <Image
                      source={{ uri: latestScreenshot.image_data }}
                      style={styles.fullscreenImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.fullscreenCaption}>
                      Captured: {formatTimestamp(latestScreenshot.created_at)}
                    </Text>
                  </View>
                )}
              </View>
            </Modal>

            <Modal
              visible={rdpSettingsVisible}
              transparent
              animationType="fade"
              onRequestClose={() => !rdpSaving && setRdpSettingsVisible(false)}
            >
              <KeyboardAvoidingView
                style={styles.rdpKeyboardAvoid}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
              >
                <View style={styles.modalOverlay}>
                  <ScrollView
                    contentContainerStyle={styles.rdpModalScrollContent}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={[styles.modalCard, styles.rdpModalCard]}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>REMOTE DESKTOP SETUP</Text>
                    <TouchableOpacity onPress={() => !rdpSaving && setRdpSettingsVisible(false)}>
                      <Text style={styles.modalCloseIcon}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.modalSubtitle}>
                    Enter the PC name or address reachable from this device, such as its LAN name or VPN address. Windows sign-in is handled by your RDP client.
                  </Text>
                  <Text style={styles.fieldLabel}>PC NAME OR ADDRESS</Text>
                  <TextInput
                    style={styles.rdpInput}
                    placeholder="e.g. my-laptop or 100.64.0.12"
                    placeholderTextColor="#64748b"
                    value={rdpHostInput}
                    onChangeText={setRdpHostInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!rdpSaving}
                  />
                  <Text style={styles.fieldLabel}>RDP PORT</Text>
                  <TextInput
                    style={styles.rdpInput}
                    placeholder="3389"
                    placeholderTextColor="#64748b"
                    value={rdpPortInput}
                    onChangeText={setRdpPortInput}
                    keyboardType="number-pad"
                    editable={!rdpSaving}
                  />
                  <Text style={styles.rdpSecurityNote}>
                    Do not expose port 3389 directly to the internet. Use a trusted VPN or local network.
                  </Text>
                  <View style={styles.modalBtnRow}>
                    <TouchableOpacity
                      style={styles.modalCancelBtn}
                      onPress={() => setRdpSettingsVisible(false)}
                      disabled={rdpSaving}
                    >
                      <Text style={styles.modalCancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalConfirmBtn, rdpSaving && styles.btnDisabled]}
                      onPress={() => void handleSaveRdpSettings()}
                      disabled={rdpSaving}
                    >
                      {rdpSaving ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text style={styles.modalConfirmBtnText}>Save Address</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                    </View>
                  </ScrollView>
                </View>
              </KeyboardAvoidingView>
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

                {/* Live Battery Telemetry Widget */}
                {typeof device.battery_level === "number" && (
                  <View style={styles.batteryCard}>
                    <View style={styles.batteryHeader}>
                      <View style={styles.batteryTitleRow}>
                        <Text style={styles.batteryIcon}>
                          {device.is_charging ? "⚡" : device.battery_level <= 20 ? "🪫" : "🔋"}
                        </Text>
                        <Text style={styles.batteryTitle}>
                          BATTERY LEVEL • {device.is_charging ? "CHARGING" : device.power_online ? "PLUGGED IN" : "ON BATTERY"}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.batteryPercentText,
                          device.battery_level <= 20
                            ? styles.batteryTextLow
                            : device.battery_level <= 50
                            ? styles.batteryTextMid
                            : styles.batteryTextHigh,
                        ]}
                      >
                        {device.battery_level}%
                      </Text>
                    </View>

                    {/* Battery Fill Track */}
                    <View style={styles.batteryTrack}>
                      <View
                        style={[
                          styles.batteryFill,
                          {
                            width: `${Math.max(5, Math.min(100, device.battery_level))}%`,
                            backgroundColor:
                              device.battery_level <= 20
                                ? "#ef4444"
                                : device.battery_level <= 50
                                ? "#f59e0b"
                                : "#10b981",
                          },
                        ]}
                      />
                    </View>
                  </View>
                )}

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

                {storedPairingKeys[device.id] ? (
                  <TouchableOpacity
                    style={styles.viewPairingKeyBtn}
                    onPress={() => {
                      setPairedDeviceName(device.name);
                      setPairingKey(storedPairingKeys[device.id]);
                      setCopiedKey(false);
                      setIsPairingModalVisible(true);
                    }}
                  >
                    <Text style={styles.viewPairingKeyBtnText}>🔑 View Pairing Key</Text>
                  </TouchableOpacity>
                ) : null}
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
                {/* HERO ACTION STATION */}
                <View style={styles.lockStationCard}>
                  <View style={styles.lockStationHeader}>
                    <Text style={styles.stationTitle}>REMOTE POWER & SECURITY</Text>
                    <Text style={styles.stationSub}>Instantly lock session, sleep, or shut down</Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.heroLockBtn,
                      (actionSubmitting !== null || isCommandActive || heartbeat.status === "offline") &&
                        styles.heroLockBtnDisabled,
                    ]}
                    onPress={handleLockLaptop}
                    disabled={actionSubmitting !== null || isCommandActive}
                    activeOpacity={0.8}
                  >
                    {actionSubmitting === "lock" ? (
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

                  {/* 2×2 Secondary Power & Security Grid */}
                  <View style={styles.powerActionsGrid}>
                    {/* Row 1: Sleep & Shutdown */}
                    <View style={styles.powerActionsRow}>
                      <TouchableOpacity
                        style={[
                          styles.powerActionBtn,
                          styles.sleepBtn,
                          (actionSubmitting !== null || isCommandActive || heartbeat.status === "offline") &&
                            styles.heroLockBtnDisabled,
                        ]}
                        onPress={handleSleepLaptop}
                        disabled={actionSubmitting !== null || isCommandActive}
                        activeOpacity={0.8}
                      >
                        {actionSubmitting === "sleep" ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <>
                            <Text style={styles.powerActionEmoji}>🌙</Text>
                            <Text style={styles.powerActionText}>SLEEP</Text>
                            <Text style={styles.powerActionSub}>Low-power</Text>
                          </>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.powerActionBtn,
                          styles.shutdownBtn,
                          (actionSubmitting !== null || isCommandActive || heartbeat.status === "offline") &&
                            styles.heroLockBtnDisabled,
                        ]}
                        onPress={handleShutdownLaptop}
                        disabled={actionSubmitting !== null || isCommandActive}
                        activeOpacity={0.8}
                      >
                        {actionSubmitting === "shutdown" ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <>
                            <Text style={styles.powerActionEmoji}>⚡</Text>
                            <Text style={styles.powerActionText}>SHUT DOWN</Text>
                            <Text style={styles.powerActionSub}>Power off</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Row 2: Snapshot & Wake/Unlock */}
                    <View style={styles.powerActionsRow}>
                      <TouchableOpacity
                        style={[
                          styles.powerActionBtn,
                          styles.screenshotBtn,
                          (actionSubmitting !== null || isCommandActive || heartbeat.status === "offline") &&
                            styles.heroLockBtnDisabled,
                        ]}
                        onPress={() => void executeRemoteAction("screenshot")}
                        disabled={actionSubmitting !== null || isCommandActive}
                        activeOpacity={0.8}
                      >
                        {actionSubmitting === "screenshot" ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <>
                            <Text style={styles.powerActionEmoji}>📸</Text>
                            <Text style={styles.powerActionText}>SNAPSHOT</Text>
                            <Text style={styles.powerActionSub}>Capture screen</Text>
                          </>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.powerActionBtn,
                          styles.unlockBtn,
                          (actionSubmitting !== null || isCommandActive || heartbeat.status === "offline") &&
                            styles.heroLockBtnDisabled,
                        ]}
                        onPress={() => void executeRemoteAction("unlock")}
                        disabled={actionSubmitting !== null || isCommandActive}
                        activeOpacity={0.8}
                      >
                        {actionSubmitting === "unlock" ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <>
                            <Text style={styles.powerActionEmoji}>☀️</Text>
                            <Text style={styles.powerActionText}>WAKE SCREEN</Text>
                            <Text style={styles.powerActionSub} numberOfLines={1}>
                              Wake display; sign in on the laptop
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.rdpCard}>
                    <View style={styles.rdpCardHeading}>
                      <View style={styles.rdpAddressBlock}>
                        <Text style={styles.rdpCardTitle}>REMOTE DESKTOP</Text>
                        <Text style={styles.rdpCardAddress} numberOfLines={2}>
                          {device.rdp_host ? `${device.rdp_host}:${device.rdp_port ?? 3389}` : "No PC address configured"}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={openRdpSettings} style={styles.rdpSettingsButton}>
                        <Text style={styles.rdpSettingsButtonText}>{device.rdp_host ? "EDIT" : "SET UP"}</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.rdpCardNote}>
                      Uses your installed Microsoft RDP client. The PC must support Remote Desktop (Windows Pro) and be reachable over LAN or VPN. Don’t expose RDP directly to the internet.
                    </Text>
                    <TouchableOpacity
                      style={styles.rdpConnectButton}
                      onPress={() => void handleConnectRemoteDesktop()}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.rdpConnectButtonText} numberOfLines={2}>
                        {device.rdp_host ? "CONNECT WITH REMOTE DESKTOP" : "CONFIGURE REMOTE DESKTOP"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <RemoteFeatures
                    deviceId={device.id}
                    userId={session.user.id}
                    telemetry={device}
                    online={heartbeat.status === "online"}
                    commandBusy={isCommandActive || actionSubmitting !== null}
                  />

                  {isCommandActive && (
                    <View style={styles.inProgressBanner}>
                      <Text style={styles.inProgressBannerText}>
                        ⚠️ Command active ({(latestCommand?.action || "COMMAND").toUpperCase()}). Duplicate submissions are temporarily locked out.
                      </Text>
                    </View>
                  )}

                  {heartbeat.status === "offline" && !isCommandActive && (
                    <Text style={styles.offlineWarningText}>
                      Notice: Agent is currently offline. Commands will queue in pending state until agent resumes.
                    </Text>
                  )}
                </View>

                {/* DESKTOP SCREEN MONITOR CARD */}
                <View style={styles.screenshotCard}>
                  <View style={styles.screenshotHeader}>
                    <View style={styles.screenshotHeaderTitleRow}>
                      <Text style={styles.screenshotCardTitle}>📸 SCREENSHOT</Text>
                      <View style={styles.liveIndicator}>
                        <View style={styles.liveIndicatorDot} />
                        <Text style={styles.liveIndicatorText}>ANTI-THEFT</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.refreshScreenshotBtn}
                      onPress={() => void executeRemoteAction("screenshot")}
                      disabled={actionSubmitting !== null || isCommandActive}
                    >
                      <Text style={styles.refreshScreenshotBtnText}>
                        {actionSubmitting === "screenshot" ? "Capturing..." : "🔄 Capture"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {latestScreenshot ? (
                    <View style={styles.screenshotPreviewContainer}>
                      <TouchableOpacity
                        onPress={() => setScreenshotModalVisible(true)}
                        activeOpacity={0.9}
                        style={styles.screenshotImageWrapper}
                      >
                        <Image
                          source={{ uri: latestScreenshot.image_data }}
                          style={styles.screenshotImage}
                          resizeMode="contain"
                        />
                        <View style={styles.screenshotOverlayPill}>
                          <Text style={styles.screenshotOverlayPillText}>🔍 Tap to View Fullscreen</Text>
                        </View>
                      </TouchableOpacity>
                      <Text style={styles.screenshotTimestamp}>
                        Captured: {formatTimestamp(latestScreenshot.created_at)}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.noScreenshotBox}>
                      <Text style={styles.noScreenshotEmoji}>🖥️</Text>
                      <Text style={styles.noScreenshotText}>No desktop snapshot captured yet.</Text>
                      <Text style={styles.noScreenshotSub}>
                        Tap &quot;Capture Now&quot; to view what is currently on your laptop screen.
                      </Text>
                    </View>
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
                            {(() => {
                              const act = (latestCommand.action || "lock").toUpperCase();
                              if (latestCommand.status === "completed") return `✓ ${act} COMPLETED`;
                              if (latestCommand.status === "failed") return `✕ ${act} FAILED`;
                              if (latestCommand.status === "claimed") return `● ${act} IN PROGRESS`;
                              return `◷ ${act} PENDING`;
                            })()}
                          </Text>
                        </View>

                        <Text style={styles.commandTime}>{formatTimestamp(latestCommand.created_at)}</Text>
                      </View>

                      {latestCommand.status === "claimed" && (
                        <Text style={styles.commandNote}>
                          Agent received the {(latestCommand.action || "remote").toLowerCase()} dispatch. Windows workstation is executing the command.
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
                    <Text style={styles.emptyFeedText}>No remote commands dispatched yet.</Text>
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
                              {(() => {
                                const act = (cmd.action || "lock").toLowerCase();
                                const labels: Record<string, string> = {
                                  lock: "Lock",
                                  sleep: "Sleep",
                                  shutdown: "Shutdown",
                                  screenshot: "Screenshot",
                                  unlock: "Wake screen",
                                  panic: "Panic capture & lock",
                                  display_message: "Display message",
                                  task_list: "Refresh running apps",
                                  end_task: "End task",
                                  refresh_status: "Refresh status",
                                  save_note: "Save quick note",
                                  screen_record: "Screen recording",
                                  rename_recording: "Rename recording",
                                };
                                const label = labels[act] || act;
                                if (cmd.status === "completed") return `${label} Executed`;
                                if (cmd.status === "failed") return `${label} Failed`;
                                if (cmd.status === "claimed") return `${label} In Progress`;
                                return `${label} Pending`;
                              })()}
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

                {/* Workstation Danger Zone / Removal */}
                <View style={styles.dangerZoneCard}>
                  <TouchableOpacity
                    style={[
                      styles.deleteDeviceBtn,
                      deletingLaptop && styles.btnDisabled,
                    ]}
                    onPress={() => void handleDeleteLaptop(device)}
                    disabled={deletingLaptop}
                    activeOpacity={0.7}
                  >
                    {deletingLaptop ? (
                      <ActivityIndicator size="small" color="#f87171" />
                    ) : (
                      <Text style={styles.deleteDeviceBtnText}>🗑 Remove {device.name}</Text>
                    )}
                  </TouchableOpacity>
                </View>
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
    </SafeAreaView>
  );
}

// Signed-out Authentication Screen
return (
  <SafeAreaView style={styles.safeAreaContainer} edges={["top", "left", "right", "bottom"]}>
    <StatusBar barStyle="light-content" backgroundColor="#090d16" />
    <ScrollView
      style={styles.screenBackground}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
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

          {!!message && (
            <View style={styles.authErrorBox}>
              <Text style={styles.authErrorText}>⚠️ {message}</Text>
            </View>
          )}

          <Text style={styles.authHintText}>
            Protected by Supabase Auth with bcrypt hashing and encrypted sessions.
          </Text>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeAreaContainer: {
    flex: 1,
    backgroundColor: "#090d16",
  },
  screenBackground: {
    flex: 1,
    backgroundColor: "#090d16",
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: Platform.select({ ios: 10, android: 16, default: 24 }),
    paddingBottom: 50,
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
    paddingHorizontal: 2,
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
  batteryCard: {
    width: "100%",
    backgroundColor: "rgba(16, 24, 39, 0.7)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  batteryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  batteryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  batteryIcon: {
    fontSize: 14,
  },
  batteryTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.8,
  },
  batteryPercentText: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  batteryTextHigh: {
    color: "#34d399",
  },
  batteryTextMid: {
    color: "#fbbf24",
  },
  batteryTextLow: {
    color: "#f87171",
  },
  batteryTrack: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },
  batteryFill: {
    height: "100%",
    borderRadius: 3,
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
    width: "100%",
  },
  stationTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#f8fafc",
    letterSpacing: 1,
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
  powerActionsGrid: {
    width: "100%",
    marginTop: 12,
    gap: 10,
  },
  powerActionsRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  powerActionBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    ...Platform.select({
      web: {
        cursor: "pointer",
      },
    }),
  },
  sleepBtn: {
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    borderColor: "rgba(99, 102, 241, 0.35)",
  },
  shutdownBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  screenshotBtn: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  unlockBtn: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  rdpCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#101a2a",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.24)",
  },
  rdpCardHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rdpAddressBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  rdpCardTitle: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  rdpCardAddress: {
    marginTop: 4,
    color: "#7dd3fc",
    fontSize: 12,
  },
  rdpSettingsButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    ...Platform.select({ web: { cursor: "pointer" } }),
  },
  rdpSettingsButtonText: {
    color: "#7dd3fc",
    fontSize: 10,
    fontWeight: "800",
  },
  rdpCardNote: {
    marginTop: 8,
    color: "#94a3b8",
    fontSize: 10,
    lineHeight: 15,
  },
  rdpConnectButton: {
    marginTop: 10,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 9,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0369a1",
    ...Platform.select({ web: { cursor: "pointer" } }),
  },
  rdpConnectButtonText: {
    color: "#f0f9ff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  rdpSecurityNote: {
    marginTop: 10,
    color: "#fbbf24",
    fontSize: 10,
    lineHeight: 15,
  },
  rdpKeyboardAvoid: {
    flex: 1,
  },
  rdpModalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  rdpModalCard: {
    maxHeight: "95%",
  },
  unlockBtnActive: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderColor: "rgba(16, 185, 129, 0.5)",
  },
  powerActionEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  powerActionText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  powerActionSub: {
    color: "#94a3b8",
    fontSize: 10,
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
  rdpInput: {
    backgroundColor: "#161f30",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    // iOS Safari zooms the page when a focused input uses a font smaller than 16px.
    fontSize: 16,
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
  authErrorBox: {
    backgroundColor: "rgba(244, 63, 94, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.35)",
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  authErrorText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
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
  pairingKeyBox: {
    backgroundColor: "#030712",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    padding: 12,
    marginBottom: 12,
  },
  pairingKeyText: {
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    color: "#38bdf8",
    lineHeight: 16,
  },
  copyKeyBtn: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.35)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 14,
  },
  copyKeyBtnSuccess: {
    backgroundColor: "rgba(52, 211, 153, 0.2)",
    borderColor: "#10b981",
  },
  copyKeyBtnText: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "700",
  },
  pairingInstructionsBox: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    padding: 12,
    marginBottom: 16,
  },
  pairingInstructionsHeader: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 1,
    marginBottom: 6,
  },
  pairingInstructionStep: {
    fontSize: 11,
    color: "#cbd5e1",
    lineHeight: 16,
    marginBottom: 2,
  },
  modalDoneBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalDoneBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  deviceActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    width: "100%",
  },
  viewPairingKeyBtn: {
    flex: 1,
    backgroundColor: "rgba(56, 189, 248, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  viewPairingKeyBtnText: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "700",
  },
  dangerZoneCard: {
    width: "100%",
    marginTop: 18,
    marginBottom: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
  },
  deleteDeviceBtn: {
    width: "100%",
    backgroundColor: "rgba(244, 63, 94, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.2)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteDeviceBtnText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  screenshotCard: {
    width: "100%",
    backgroundColor: "#161f30",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    padding: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  screenshotHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    width: "100%",
    gap: 8,
  },
  screenshotHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  screenshotCardTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: "#94a3b8",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  refreshScreenshotBtn: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.35)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexShrink: 0,
    alignSelf: "center",
  },
  refreshScreenshotBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38bdf8",
  },
  screenshotPreviewContainer: {
    width: "100%",
    alignItems: "center",
  },
  screenshotImageWrapper: {
    width: "100%",
    height: 190,
    backgroundColor: "#0b0f19",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  screenshotImage: {
    width: "100%",
    height: "100%",
  },
  screenshotOverlayPill: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  screenshotOverlayPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#f8fafc",
  },
  screenshotTimestamp: {
    fontSize: 10,
    color: "#64748b",
    marginTop: 8,
  },
  noScreenshotBox: {
    width: "100%",
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  noScreenshotEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  noScreenshotText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#cbd5e1",
    textAlign: "center",
  },
  noScreenshotSub: {
    fontSize: 11,
    color: "#64748b",
    textAlign: "center",
    marginTop: 4,
  },
  fullscreenModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.95)",
    padding: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenModalHeader: {
    width: "100%",
    maxWidth: 900,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  fullscreenModalTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#f8fafc",
    letterSpacing: 1,
  },
  fullscreenCloseBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  fullscreenCloseBtnText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
  },
  fullscreenImageContainer: {
    width: "100%",
    maxWidth: 900,
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenImage: {
    width: "100%",
    height: "90%",
  },
  fullscreenCaption: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 8,
    textAlign: "center",
  },
  passwordBannerBtn: {
    width: "100%",
    marginTop: 12,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...Platform.select({
      web: {
        cursor: "pointer",
      },
    }),
  },
  passwordBannerBtnActive: {
    backgroundColor: "rgba(16, 185, 129, 0.06)",
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  passwordBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  passwordBannerIcon: {
    fontSize: 18,
  },
  passwordBannerTextWrapper: {
    flex: 1,
  },
  passwordBannerTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#f1f5f9",
  },
  passwordBannerSub: {
    fontSize: 10,
    color: "#94a3b8",
    marginTop: 2,
    lineHeight: 14,
  },
  passwordBannerPill: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  passwordBannerPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38bdf8",
  },
  passwordSecurityNote: {
    backgroundColor: "rgba(56, 189, 248, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  passwordSecurityNoteText: {
    fontSize: 11,
    color: "#7dd3fc",
    lineHeight: 16,
  },
  passwordInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  passwordInputFlex: {
    flex: 1,
    marginBottom: 0,
  },
  showPasswordBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 10,
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  showPasswordBtnText: {
    fontSize: 18,
  },
  modalClearBtn: {
    flex: 1,
    backgroundColor: "rgba(244, 63, 94, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.25)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalClearBtnText: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: "700",
  },
});
