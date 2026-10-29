import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

type Telemetry = {
  network_name?: string | null;
  network_type?: string | null;
  local_ip?: string | null;
  disk_free_gb?: number | null;
  disk_total_gb?: number | null;
  memory_used_gb?: number | null;
  memory_total_gb?: number | null;
};

type RunningTask = { process_id: number; name: string; window: string; memory_mb: number };
type QuickNote = { id: string; title: string; body: string; created_at: string };
type ScreenRecording = { id: string; created_at: string; file_name: string; duration_seconds?: number; local_path?: string; storage_path?: string; sent_to_phone?: boolean; send_error?: string };

type Props = {
  deviceId: string;
  userId: string;
  telemetry: Telemetry;
  online: boolean;
  commandBusy: boolean;
};

export function RemoteFeatures({ deviceId, userId, telemetry, online, commandBusy }: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [localActiveCommand, setLocalActiveCommand] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [recordingName, setRecordingName] = useState("");
  const [sendRecordingToPhone, setSendRecordingToPhone] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [recordingActionLoading, setRecordingActionLoading] = useState(false);
  const [recordings, setRecordings] = useState<ScreenRecording[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [renamingRecordingId, setRenamingRecordingId] = useState<string | null>(null);
  const [renamingRecordingName, setRenamingRecordingName] = useState("");
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [pendingDeleteRecording, setPendingDeleteRecording] = useState<ScreenRecording | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [appsExpanded, setAppsExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);

  const loadRecordings = useCallback(async () => {
    setRecordingsLoading(true);
    const { data, error } = await supabase
      .from("commands")
      .select("id,action,status,created_at,result")
      .eq("device_id", deviceId)
      .eq("user_id", userId)
      .in("action", ["screen_record", "rename_recording", "delete_recording"])
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error) {
      const rows = data ?? [];
      const latestNames = new Map<string, string>();
      const deletedIds = new Set<string>();
      for (const row of rows) {
        const result = row.result as Record<string, unknown> | null;
        if (row.action === "rename_recording" && row.status === "completed" && typeof result?.recording_id === "string" && typeof result.file_name === "string" && !latestNames.has(result.recording_id)) {
          latestNames.set(result.recording_id, result.file_name);
        }
        if (row.action === "delete_recording" && row.status === "completed" && typeof result?.recording_id === "string") {
          deletedIds.add(result.recording_id);
        }
      }
      const items = rows.flatMap((row) => {
        if (row.action !== "screen_record") return [];
        const result = row.result as Record<string, unknown> | null;
        if (row.status !== "completed" || result?.saved_locally !== true || deletedIds.has(row.id)) return [];
        return [{
          id: row.id,
          created_at: row.created_at,
          file_name: latestNames.get(row.id) || String(result.file_name || "Screen recording.mp4"),
          duration_seconds: typeof result.duration_seconds === "number" ? result.duration_seconds : undefined,
          local_path: typeof result.local_path === "string" ? result.local_path : undefined,
          storage_path: typeof result.storage_path === "string" ? result.storage_path : undefined,
          sent_to_phone: result.sent_to_phone === true,
          send_error: typeof result.send_error === "string" ? result.send_error : undefined,
        }];
      });
      setRecordings(items as ScreenRecording[]);
    }
    setRecordingsLoading(false);
  }, [deviceId, userId]);

  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    const { data, error } = await supabase
      .from("quick_notes")
      .select("id,title,body,created_at")
      .eq("device_id", deviceId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (!error) setNotes((data ?? []) as QuickNote[]);
    setNotesLoading(false);
  }, [deviceId, userId]);

  useEffect(() => {
    const timerId = setTimeout(() => { void loadNotes(); }, 0);
    return () => clearTimeout(timerId);
  }, [loadNotes]);

  useEffect(() => {
    const timerId = setTimeout(() => { void loadRecordings(); }, 0);
    return () => clearTimeout(timerId);
  }, [loadRecordings]);

  useEffect(() => {
    if (!localActiveCommand) return;
    let active = true;
    const timerId = setInterval(async () => {
      const { data } = await supabase.from("commands").select("status").eq("id", localActiveCommand).eq("user_id", userId).maybeSingle();
      if (active && (data?.status === "completed" || data?.status === "failed")) setLocalActiveCommand(null);
    }, 2000);
    return () => { active = false; clearInterval(timerId); };
  }, [localActiveCommand, userId]);

  const sendCommand = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (commandBusy || sending || localActiveCommand) {
      Alert.alert("Command in progress", "Wait for the current laptop command to finish.");
      return null;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("request-lock", {
        body: { device_id: deviceId, action, payload },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Could not send the command.");
      const commandId = data.command?.id as string | undefined;
      if (commandId) setLocalActiveCommand(commandId);
      return commandId;
    } catch (error) {
      setLocalActiveCommand(null);
      Alert.alert("Command failed", error instanceof Error ? error.message : "Could not send the command.");
      return null;
    } finally {
      setSending(false);
    }
  }, [commandBusy, deviceId, localActiveCommand, sending]);

  async function sendMessage() {
    const value = message.trim();
    if (!value) return;
    const commandId = await sendCommand("display_message", { message: value });
    if (commandId) {
      setMessage("");
      Alert.alert("Message sent", "The laptop will show your message when its agent receives it.");
    }
  }

  function confirmPanic() {
    const execute = async () => {
      const commandId = await sendCommand("panic");
      if (commandId) Alert.alert("Panic action sent", "The laptop will capture its screen and lock.");
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm("Capture the laptop screen and lock it now?")) void execute();
      return;
    }
    Alert.alert("Lock laptop now?", "This captures a screenshot and then locks the Windows session.", [
      { text: "Cancel", style: "cancel" },
      { text: "Lock & Capture", style: "destructive", onPress: () => void execute() },
    ]);
  }

  async function refreshTasks() {
    setTaskLoading(true);
    setTasks([]);
    const commandId = await sendCommand("task_list");
    if (!commandId) { setTaskLoading(false); return; }
    try {
      for (let attempt = 0; attempt < 18; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { data, error } = await supabase.from("commands").select("status,result,failure_reason").eq("id", commandId).eq("user_id", userId).maybeSingle();
        if (error) throw error;
        if (data?.status === "completed") {
          const result = data.result as { tasks?: RunningTask[] } | null;
          setTasks(Array.isArray(result?.tasks) ? result.tasks : []);
          return;
        }
        if (data?.status === "failed") throw new Error(data.failure_reason || "Windows could not list running apps.");
      }
      Alert.alert("Still waiting", "The Windows agent has not returned the task list yet.");
    } catch (error) {
      Alert.alert("Could not load tasks", error instanceof Error ? error.message : "Try again when the laptop is online.");
    } finally {
      setTaskLoading(false);
    }
  }

  function confirmEndTask(task: RunningTask) {
    const execute = async () => {
      const commandId = await sendCommand("end_task", { process_id: task.process_id, process_name: task.name });
      if (commandId) {
        try {
          for (let attempt = 0; attempt < 18; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const { data, error } = await supabase.from("commands").select("status,failure_reason").eq("id", commandId).eq("user_id", userId).maybeSingle();
            if (error) throw error;
            if (data?.status === "completed") {
              setTasks((current) => current.filter((item) => item.process_id !== task.process_id));
              Alert.alert("Task ended", `${task.name} was closed.`);
              return;
            }
            if (data?.status === "failed") throw new Error(data.failure_reason || "Windows did not close this app.");
          }
          Alert.alert("Still waiting", "The laptop has not confirmed whether the app closed yet.");
        } catch (error) {
          Alert.alert("Could not end task", error instanceof Error ? error.message : "Try again when the laptop is online.");
        }
      }
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`End ${task.name}? Unsaved work in the app may be lost.`)) void execute();
      return;
    }
    Alert.alert(`End ${task.name}?`, "Unsaved work in this app may be lost.", [
      { text: "Cancel", style: "cancel" },
      { text: "End task", style: "destructive", onPress: () => void execute() },
    ]);
  }

  async function saveNote() {
    const title = noteTitle.trim() || "Quick note";
    const body = noteBody.trim();
    if (!body) {
      Alert.alert("Add a note", "Write something before saving.");
      return;
    }
    setNotesLoading(true);
    const { data, error } = await supabase.from("quick_notes").insert({ device_id: deviceId, user_id: userId, title, body }).select("id,title,body,created_at").single();
    if (error) {
      setNotesLoading(false);
      Alert.alert("Could not save note", error.message);
      return;
    }
    setNotes((current) => [data as QuickNote, ...current].slice(0, 20));
    setNoteTitle("");
    setNoteBody("");
    setNotesLoading(false);
    const commandId = await sendCommand("save_note", { title, body });
    if (!commandId) return;
    try {
      for (let attempt = 0; attempt < 18; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { data: command, error: commandError } = await supabase
          .from("commands")
          .select("status,result,failure_reason")
          .eq("id", commandId)
          .eq("user_id", userId)
          .maybeSingle();
        if (commandError) throw commandError;
        if (command?.status === "failed") throw new Error(command.failure_reason || "The laptop could not open the note.");
        if (command?.status === "completed") {
          setLocalActiveCommand(null);
          const result = command.result as { display_method?: string } | null;
          const location = result?.display_method === "microsoft_sticky_notes"
            ? "It was added to Microsoft Sticky Notes."
            : "The laptop reported that the note was delivered.";
          Alert.alert("Note delivered", `${location} A copy is saved in Documents/Laptop Lock Notes.`);
          return;
        }
      }
      Alert.alert("Note saved, delivery pending", "The note is saved to your account, but the laptop has not confirmed it yet. Try Send again when the laptop agent is online.");
    } catch (error) {
      Alert.alert("Note saved, delivery failed", error instanceof Error ? error.message : "The laptop could not confirm delivery. Try Send again.");
    }
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase.from("quick_notes").delete().eq("id", noteId).eq("user_id", userId);
    if (error) Alert.alert("Could not delete note", error.message);
    else setNotes((current) => current.filter((note) => note.id !== noteId));
  }

  async function sendSavedNote(note: QuickNote) {
    const commandId = await sendCommand("save_note", { title: note.title, body: note.body });
    if (commandId) Alert.alert("Note queued", "The laptop will save and open this note when its agent is ready.");
  }

  const waitForRecordingCommand = useCallback(async (commandId: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const { data, error } = await supabase.from("commands").select("status,result,failure_reason").eq("id", commandId).eq("user_id", userId).maybeSingle();
      if (error) throw error;
      if (data?.status === "failed") throw new Error(data.failure_reason || "The laptop could not complete the recording action.");
      if (data?.status === "completed") return data.result as Record<string, unknown> | null;
    }
    throw new Error("The laptop has not confirmed the recording action yet.");
  }, [userId]);

  async function startScreenRecording() {
    const name = recordingName.trim() || "Screen recording";
    setRecordingActionLoading(true);
    try {
      const commandId = await sendCommand("screen_record", { mode: "start", name, send_to_phone: sendRecordingToPhone, max_seconds: 60 });
      if (!commandId) return;
      const result = await waitForRecordingCommand(commandId);
      setRecording(true);
      setRecordingSince(typeof result?.started_at === "string" ? Date.parse(result.started_at) : Date.now());
      setRecordingName(name);
      Alert.alert("Recording started", "The laptop desktop is being captured. Stop it here, or it will save automatically after one minute.");
    } catch (error) {
      Alert.alert("Could not start recording", error instanceof Error ? error.message : "Check that the laptop is online and try again.");
    } finally {
      setRecordingActionLoading(false);
    }
  }

  async function refreshRecordingStatus() {
    setRecordingActionLoading(true);
    try {
      const commandId = await sendCommand("screen_record", { mode: "status" });
      if (!commandId) return;
      const result = await waitForRecordingCommand(commandId);
      const active = result?.recording === true;
      setRecording(active);
      setRecordingSince(active && typeof result?.started_at === "string" ? Date.parse(result.started_at) : null);
      if (!active) await loadRecordings();
    } catch (error) {
      Alert.alert("Could not check recording", error instanceof Error ? error.message : "Try again when the laptop is online.");
    } finally {
      setRecordingActionLoading(false);
    }
  }

  const stopScreenRecording = useCallback(async () => {
    setRecordingActionLoading(true);
    try {
      const commandId = await sendCommand("screen_record", { mode: "stop" });
      if (!commandId) return;
      const result = await waitForRecordingCommand(commandId);
      setRecording(false);
      setRecordingSince(null);
      await loadRecordings();
      const saved = result?.saved_locally === true ? `Saved on laptop as ${String(result.file_name || "Screen recording.mp4")} in Videos/Laptop Lock Recordings.` : "The laptop stopped the recording.";
      const delivery = result?.sent_to_phone === true
        ? " A private copy is ready in this controller and can be opened or shared."
        : typeof result?.send_error === "string"
          ? ` The local copy is safe, but sending failed: ${result.send_error}`
          : sendRecordingToPhone ? " The recording was saved locally; no phone copy was created." : "";
      Alert.alert("Recording saved", saved + delivery);
    } catch (error) {
      Alert.alert("Could not stop recording", error instanceof Error ? error.message : "Try Stop again when the laptop is online.");
    } finally {
      setRecordingActionLoading(false);
    }
  }, [loadRecordings, sendCommand, sendRecordingToPhone, waitForRecordingCommand]);

  useEffect(() => {
    if (!recording || recordingSince == null) return;
    const remainingMs = Math.max(0, 55_000 - (Date.now() - recordingSince));
    const timerId = setTimeout(() => {
      if (Date.now() - recordingSince >= 58_000) {
        setRecording(false);
        setRecordingSince(null);
        void loadRecordings();
      } else {
        void stopScreenRecording();
      }
    }, remainingMs);
    return () => clearTimeout(timerId);
  }, [loadRecordings, recording, recordingSince, stopScreenRecording]);

  async function getRecordingUrl(item: ScreenRecording, download = false) {
    const { data, error } = await supabase.functions.invoke("recording-link", { body: { command_id: item.id, file_name: item.file_name, download } });
    if (error || !data?.signed_url) throw new Error(data?.error || error?.message || "Could not open this private video.");
    return String(data.signed_url);
  }

  async function openRecording(item: ScreenRecording) {
    try { await Linking.openURL(await getRecordingUrl(item)); }
    catch (error) { Alert.alert("Could not open recording", error instanceof Error ? error.message : "Try again."); }
  }

  async function downloadRecording(item: ScreenRecording) {
    try { await Linking.openURL(await getRecordingUrl(item, true)); }
    catch (error) { Alert.alert("Could not download recording", error instanceof Error ? error.message : "Try again."); }
  }

  async function shareRecording(item: ScreenRecording) {
    try {
      const url = await getRecordingUrl(item);
      await Share.share({ title: item.file_name, message: `${item.file_name}\n${url}`, url });
    } catch (error) { Alert.alert("Could not share recording", error instanceof Error ? error.message : "Try again."); }
  }

  async function renameRecording(item: ScreenRecording) {
    const newName = renamingRecordingName.trim();
    if (!newName) { Alert.alert("Add a name", "Enter a name for this clip."); return; }
    try {
      const commandId = await sendCommand("rename_recording", { recording_id: item.id, file_name: item.file_name, new_name: newName });
      if (!commandId) return;
      await waitForRecordingCommand(commandId);
      setRenamingRecordingId(null);
      setRenamingRecordingName("");
      await loadRecordings();
    } catch (error) {
      Alert.alert("Could not rename clip", error instanceof Error ? error.message : "Try again when the laptop is online.");
    }
  }

  async function deleteRecording(item: ScreenRecording) {
    if (!online) { Alert.alert("Laptop is offline", "Reconnect the laptop before deleting its saved clip."); return; }
    setDeletingRecordingId(item.id);
    let phoneCopyDeleted = false;
    try {
      if (item.storage_path) {
        const { data, error } = await supabase.functions.invoke("recording-link", { body: { action: "delete", command_id: item.id } });
        if (error || data?.deleted !== true) throw new Error(data?.error || error?.message || "Could not delete the phone copy.");
        phoneCopyDeleted = true;
      }
      const commandId = await sendCommand("delete_recording", { recording_id: item.id, file_name: item.file_name });
      if (!commandId) throw new Error("The phone copy was removed, but the laptop could not confirm the local deletion.");
      await waitForRecordingCommand(commandId);
      setRecordings((current) => current.filter((recordingItem) => recordingItem.id !== item.id));
      setPendingDeleteRecording(null);
      Alert.alert("Video deleted", phoneCopyDeleted ? "The laptop file and in-app phone copy were deleted. Any files already downloaded to the phone remain there." : "The saved laptop video was deleted.");
    } catch (error) {
      setPendingDeleteRecording(null);
      await loadRecordings();
      const detail = error instanceof Error ? error.message : "Try again when the laptop is online.";
      Alert.alert(phoneCopyDeleted ? "Phone copy deleted" : "Could not delete video", phoneCopyDeleted ? `The phone copy is gone, but the laptop copy may remain. ${detail}` : detail);
    } finally {
      setDeletingRecordingId(null);
    }
  }

  function confirmDeleteRecording(item: ScreenRecording) {
    setPendingDeleteRecording(item);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.heading}><Text style={styles.title}>Quick actions</Text><Text style={styles.subtitle}>Send a message or secure the laptop</Text></View>
        <TextInput style={styles.input} placeholder="Type a message for Windows..." placeholderTextColor="#8090a5" value={message} onChangeText={setMessage} maxLength={500} multiline />
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionButton, (!online || sending || commandBusy || !!localActiveCommand || !message.trim()) && styles.disabled]} onPress={() => void sendMessage()} disabled={!online || sending || commandBusy || !!localActiveCommand || !message.trim()}>
            <Text style={styles.primaryButtonText}>{sending ? "Sending..." : "Send message"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.panicButton, (!online || sending || commandBusy || !!localActiveCommand) && styles.disabled]} onPress={confirmPanic} disabled={!online || sending || commandBusy || !!localActiveCommand}>
            <Text style={styles.panicText}>Panic lock</Text>
          </TouchableOpacity>
        </View>
        {!online && <Text style={styles.muted}>Laptop is offline. Quick actions are disabled until its agent reconnects.</Text>}
      </View>

      <View style={styles.card}>
        <TouchableOpacity style={styles.sectionHeader} onPress={() => setDetailsExpanded((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: detailsExpanded }}>
          <View>
            <Text style={styles.title}>System status</Text>
            <Text style={styles.subtitle}>{detailsExpanded ? "Latest report from the Windows agent" : telemetry.network_name || "Tap to view network and storage"}</Text>
          </View>
          <Text style={styles.chevron}>{detailsExpanded ? "-" : "+"}</Text>
        </TouchableOpacity>
        {detailsExpanded && <>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Connection</Text><Text style={styles.infoValue}>{telemetry.network_type || "\u2014"}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Local IP</Text><Text style={styles.infoValue}>{telemetry.local_ip || "\u2014"}</Text></View>
          <Metric label="Storage free" used={telemetry.disk_total_gb != null && telemetry.disk_free_gb != null ? telemetry.disk_total_gb - telemetry.disk_free_gb : null} total={telemetry.disk_total_gb} unit="GB" />
          <Metric label="Memory used" used={telemetry.memory_used_gb} total={telemetry.memory_total_gb} unit="GB" />
          <Text style={styles.footnote}>Updates when the laptop checks in.</Text>
        </>}
      </View>

      <View style={styles.card}>
        <TouchableOpacity style={styles.sectionHeader} onPress={() => setAppsExpanded((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: appsExpanded }}>
          <View><Text style={styles.title}>Running apps</Text><Text style={styles.subtitle}>{appsExpanded ? "Close a visible app" : "See what is open on your laptop"}</Text></View>
          <Text style={styles.chevron}>{appsExpanded ? "-" : "+"}</Text>
        </TouchableOpacity>
        {appsExpanded && <>
          <TouchableOpacity style={[styles.secondaryButton, (!online || taskLoading || sending || commandBusy || !!localActiveCommand) && styles.disabled]} onPress={() => void refreshTasks()} disabled={!online || taskLoading || sending || commandBusy || !!localActiveCommand}>
            {taskLoading ? <ActivityIndicator color="#bfdbfe" size="small" /> : <Text style={styles.secondaryButtonText}>Refresh app list</Text>}
          </TouchableOpacity>
          {tasks.map((task) => (
            <View key={task.process_id} style={styles.taskRow}>
              <View style={styles.taskDetails}><Text style={styles.taskName} numberOfLines={1}>{task.name}</Text><Text style={styles.taskMeta} numberOfLines={1}>{task.window || "PID " + task.process_id} | {task.memory_mb} MB</Text></View>
              <TouchableOpacity style={styles.endButton} onPress={() => confirmEndTask(task)} disabled={!online || sending || commandBusy || !!localActiveCommand}><Text style={styles.endButtonText}>End</Text></TouchableOpacity>
            </View>
          ))}
          {!taskLoading && tasks.length === 0 && <Text style={styles.muted}>Refresh to see open desktop apps.</Text>}
        </>}
      </View>

      <View style={styles.card}>
        <View style={styles.heading}>
          <Text style={styles.title}>Screen recording</Text>
          <Text style={styles.subtitle}>Capture the laptop desktop for up to one minute</Text>
        </View>
        {recording && <View style={styles.recordingBadge}><View style={styles.recordingDot} /><Text style={styles.recordingBadgeText}>Recording on laptop · stops automatically at 60 seconds</Text></View>}
        <TextInput style={styles.input} placeholder="Recording name" placeholderTextColor="#8090a5" value={recordingName} onChangeText={setRecordingName} maxLength={80} editable={!recording} />
        <View style={styles.recordingOption}>
          <View style={styles.recordingOptionCopy}><Text style={styles.infoLabel}>Send a copy to this phone</Text><Text style={styles.recordingOptionHint}>The original is always saved on the laptop.</Text></View>
          <Switch value={sendRecordingToPhone} onValueChange={setSendRecordingToPhone} disabled={recording || recordingActionLoading} trackColor={{ false: "#334155", true: "#2563eb" }} thumbColor="#f8fafc" />
        </View>
        <TouchableOpacity
          style={[styles.recordingButton, recording && styles.recordingStopButton, (!online || sending || commandBusy || !!localActiveCommand || recordingActionLoading) && styles.disabled]}
          onPress={() => void (recording ? stopScreenRecording() : startScreenRecording())}
          disabled={!online || sending || commandBusy || !!localActiveCommand || recordingActionLoading}
          accessibilityRole="button"
        >
          {recordingActionLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.recordingButtonText}>{recording ? "Stop & save recording" : "Start recording (max 60 sec)"}</Text>}
        </TouchableOpacity>
        <Text style={styles.footnote}>Keep the app you want to capture open. Clips are saved to Videos/Laptop Lock Recordings.</Text>
        <TouchableOpacity style={styles.recordingStatusButton} onPress={() => void refreshRecordingStatus()} disabled={!online || sending || commandBusy || !!localActiveCommand || recordingActionLoading} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>{recordingActionLoading ? "Checking..." : "Check Windows recording status"}</Text>
        </TouchableOpacity>
        <View style={styles.recordingListHeading}><Text style={styles.infoLabel}>Recent clips</Text><TouchableOpacity onPress={() => void loadRecordings()} disabled={recordingsLoading}><Text style={styles.sendText}>{recordingsLoading ? "Loading" : "Refresh"}</Text></TouchableOpacity></View>
        {recordings.map((item) => {
          const isRenaming = renamingRecordingId === item.id;
          const isDeleting = deletingRecordingId === item.id;
          const phoneActionDisabled = sending || commandBusy || !!localActiveCommand || isDeleting || deletingRecordingId !== null;
          const actionDisabled = !online || phoneActionDisabled || recordingActionLoading;
          return (
            <View key={item.id} style={styles.recordingCard}>
              <View style={styles.recordingMainRow}>
                <View style={styles.recordingThumb} accessibilityLabel="MP4 video">
                  <Text style={styles.recordingThumbPlay}>▶</Text>
                  <Text style={styles.recordingThumbLabel}>MP4</Text>
                </View>
                <View style={styles.recordingDetails}>
                  <Text style={styles.recordingFileName} numberOfLines={1}>{item.file_name.replace(/\.mp4$/i, "")}</Text>
                  <Text style={styles.recordingMeta}>{item.duration_seconds ? `${item.duration_seconds}s · ` : ""}{item.storage_path ? "Laptop + phone" : "Laptop only"}</Text>
                </View>
              </View>
              {isRenaming && <TextInput style={styles.renameInput} value={renamingRecordingName} onChangeText={setRenamingRecordingName} placeholder="Video name" placeholderTextColor="#8090a5" maxLength={80} returnKeyType="done" onSubmitEditing={() => void renameRecording(item)} autoFocus />}
              {!isRenaming && item.storage_path && <View style={styles.recordingCtaRow}>
                <TouchableOpacity style={[styles.recordingCta, styles.recordingCtaPrimary]} onPress={() => void openRecording(item)} disabled={phoneActionDisabled} accessibilityLabel="Open video"><Text style={styles.recordingCtaPrimaryText}>Open</Text></TouchableOpacity>
                <TouchableOpacity style={styles.recordingCta} onPress={() => void downloadRecording(item)} disabled={phoneActionDisabled} accessibilityLabel="Download video to this phone"><Text style={styles.recordingCtaText}>Download</Text></TouchableOpacity>
                <TouchableOpacity style={styles.recordingCta} onPress={() => void shareRecording(item)} disabled={phoneActionDisabled} accessibilityLabel="Share video"><Text style={styles.recordingCtaText}>Share</Text></TouchableOpacity>
              </View>}
              <View style={styles.recordingCtaRow}>
                {isRenaming ? <>
                  <TouchableOpacity style={[styles.recordingCta, styles.recordingCtaPrimary, actionDisabled && styles.disabled]} onPress={() => void renameRecording(item)} disabled={actionDisabled}><Text style={styles.recordingCtaPrimaryText}>Save name</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.recordingCta} onPress={() => { setRenamingRecordingId(null); setRenamingRecordingName(""); }}><Text style={styles.recordingCtaText}>Cancel</Text></TouchableOpacity>
                </> : <>
                  <TouchableOpacity style={styles.recordingCta} onPress={() => { setRenamingRecordingId(item.id); setRenamingRecordingName(item.file_name.replace(/\.mp4$/i, "")); }} disabled={actionDisabled} accessibilityLabel="Rename video"><Text style={styles.recordingCtaText}>Rename</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.recordingCta, styles.recordingCtaDanger, actionDisabled && styles.disabled]} onPress={() => confirmDeleteRecording(item)} disabled={actionDisabled} accessibilityLabel="Delete video">
                    {isDeleting ? <ActivityIndicator color="#fda4af" size="small" /> : <Text style={styles.recordingCtaDangerText}>Delete</Text>}
                  </TouchableOpacity>
                </>}
              </View>
            </View>
          );
        })}
        {!recordingsLoading && recordings.length === 0 && <Text style={styles.muted}>Your saved clips will appear here. Turn on the phone-copy option before recording to open and share them from this list.</Text>}
      </View>

      <View style={styles.card}>
        <TouchableOpacity style={styles.sectionHeader} onPress={() => setNotesExpanded((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: notesExpanded }}>
          <View><Text style={styles.title}>Quick notes</Text><Text style={styles.subtitle}>{notes.length ? notes.length + (notes.length === 1 ? " saved note" : " saved notes") : "Write a note for your laptop"}</Text></View>
          <Text style={styles.chevron}>{notesExpanded ? "-" : "+"}</Text>
        </TouchableOpacity>
        {notesExpanded && <>
          <Text style={styles.muted}>Notes are added to Microsoft Sticky Notes. A backup is saved in Documents.</Text>
          <TextInput style={styles.input} placeholder="Title (optional)" placeholderTextColor="#8090a5" value={noteTitle} onChangeText={setNoteTitle} maxLength={100} />
          <TextInput style={[styles.input, styles.noteBody]} placeholder="Write your note..." placeholderTextColor="#8090a5" value={noteBody} onChangeText={setNoteBody} maxLength={5000} multiline textAlignVertical="top" />
          <TouchableOpacity style={[styles.primaryButton, (notesLoading || !noteBody.trim()) && styles.disabled]} onPress={() => void saveNote()} disabled={notesLoading || !noteBody.trim()}>
            <Text style={styles.primaryButtonText}>{notesLoading ? "Saving..." : "Save & send"}</Text>
          </TouchableOpacity>
          {notesLoading && notes.length === 0 && <ActivityIndicator color="#60a5fa" style={styles.loader} />}
          {notes.map((note) => (
            <View key={note.id} style={styles.noteRow}>
              <View style={styles.noteContent}><Text style={styles.noteName} numberOfLines={1}>{note.title}</Text><Text style={styles.notePreview} numberOfLines={2}>{note.body}</Text></View>
              <View style={styles.noteActions}>
                <TouchableOpacity onPress={() => void sendSavedNote(note)} disabled={!online || sending || commandBusy || !!localActiveCommand} accessibilityLabel="Send note to laptop"><Text style={[styles.sendText, (!online || sending || commandBusy || !!localActiveCommand) && styles.actionDisabled]}>Send</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => void deleteNote(note.id)} accessibilityLabel="Delete note"><Text style={styles.deleteText}>Delete</Text></TouchableOpacity>
              </View>
            </View>
          ))}
          {!notesLoading && notes.length === 0 && <Text style={styles.muted}>Notes you save here are private to your account.</Text>}
        </>}
      </View>
      <Modal visible={pendingDeleteRecording !== null} transparent animationType="fade" onRequestClose={() => deletingRecordingId === null && setPendingDeleteRecording(null)}>
        <View style={styles.deleteModalOverlay}>
          <View style={styles.deleteModalCard}>
            <Text style={styles.title}>Delete this video?</Text>
            <Text style={styles.muted}>{pendingDeleteRecording?.storage_path ? "This permanently removes the laptop file and the in-app phone copy. Files already downloaded to your phone stay there." : "This permanently removes the video saved on the laptop."}</Text>
            <View style={styles.deleteModalActions}>
              <TouchableOpacity style={styles.recordingCta} onPress={() => setPendingDeleteRecording(null)} disabled={deletingRecordingId !== null}><Text style={styles.recordingCtaText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.recordingCta, styles.recordingCtaDanger]} onPress={() => pendingDeleteRecording && void deleteRecording(pendingDeleteRecording)} disabled={deletingRecordingId !== null}>
                {deletingRecordingId !== null ? <ActivityIndicator color="#fda4af" size="small" /> : <Text style={styles.recordingCtaDangerText}>Delete video</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Metric({ label, used, total, unit }: { label: string; used: number | null | undefined; total: number | null | undefined; unit: string }) {
  if (used == null || total == null || total <= 0) return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>Waiting for data</Text></View>;
  const percentage = Math.max(0, Math.min(100, (used / total) * 100));
  return (
    <View style={styles.metric}>
      <View style={styles.metricHeader}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.metricText}>{used.toFixed(1)} / {total.toFixed(1)} {unit}</Text></View>
      <View style={styles.track}><View style={[styles.fill, { width: `${percentage}%`, backgroundColor: percentage > 88 ? "#fb7185" : "#60a5fa" }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The dashboard parent centers its children; explicitly stretch this group so
  // the cards don't size themselves to their widest text on narrow screens.
  wrap: { width: "100%", alignSelf: "stretch", minWidth: 0, marginTop: 14 },
  card: { width: "100%", minWidth: 0, paddingVertical: 13, gap: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  sectionHeader: { width: "100%", minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  chevron: { color: "#94a3b8", fontSize: 22, fontWeight: "300", width: 28, textAlign: "center" },
  heading: { gap: 4, marginBottom: 2 },
  title: { color: "#f1f5f9", fontSize: 16, fontWeight: "700" },
  subtitle: { color: "#94a3b8", fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: "row", gap: 9 },
  actionButton: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 12, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  input: { width: "100%", minWidth: 0, minHeight: 48, backgroundColor: "#0b1220", borderColor: "#334155", borderWidth: 1, borderRadius: 12, color: "#f8fafc", paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  noteBody: { minHeight: 100 },
  primaryButton: { width: "100%", minWidth: 0, minHeight: 46, borderRadius: 12, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  panicButton: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,107,129,0.25)", backgroundColor: "rgba(255,77,104,0.10)", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  panicText: { color: "#ff9bab", fontSize: 13, fontWeight: "700" },
  recordingOption: { width: "100%", minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 12, backgroundColor: "rgba(15,23,42,0.65)", paddingHorizontal: 12, paddingVertical: 8 },
  recordingOptionCopy: { flex: 1, minWidth: 0, gap: 3 },
  recordingOptionHint: { color: "#94a3b8", fontSize: 12, lineHeight: 16 },
  recordingBadge: { width: "100%", minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 11, borderWidth: 1, borderColor: "rgba(248,113,113,0.35)", backgroundColor: "rgba(127,29,29,0.22)", paddingHorizontal: 12 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#f87171" },
  recordingBadgeText: { flex: 1, color: "#fecaca", fontSize: 12, fontWeight: "700" },
  recordingButton: { width: "100%", minHeight: 48, borderRadius: 13, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  recordingStopButton: { backgroundColor: "#991b1b" },
  recordingButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  recordingStatusButton: { width: "100%", minHeight: 40, borderRadius: 11, backgroundColor: "rgba(148,163,184,0.10)", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  recordingListHeading: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 4 },
  recordingCard: { width: "100%", minWidth: 0, gap: 9, marginTop: 3, padding: 11, borderRadius: 14, backgroundColor: "rgba(15,23,42,0.72)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)" },
  recordingMainRow: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  recordingThumb: { width: 48, height: 48, flexShrink: 0, alignItems: "center", justifyContent: "center", gap: 1, borderRadius: 10, backgroundColor: "#111b2b", borderWidth: 1, borderColor: "rgba(96,165,250,0.24)" },
  recordingThumbPlay: { color: "#93c5fd", fontSize: 16, lineHeight: 18 },
  recordingThumbLabel: { color: "#94a3b8", fontSize: 8, fontWeight: "800", letterSpacing: 0.8 },
  recordingDetails: { flex: 1, minWidth: 0, gap: 4 },
  recordingFileName: { minWidth: 0, color: "#f1f5f9", fontSize: 13, fontWeight: "700" },
  recordingMeta: { color: "#94a3b8", fontSize: 11 },
  recordingCtaRow: { width: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  recordingCta: { flex: 1, minWidth: 76, minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: 10, backgroundColor: "rgba(148,163,184,0.10)", borderWidth: 1, borderColor: "rgba(148,163,184,0.17)" },
  recordingCtaText: { color: "#dbeafe", fontSize: 12, fontWeight: "700" },
  recordingCtaPrimary: { backgroundColor: "rgba(37,99,235,0.22)", borderColor: "rgba(96,165,250,0.35)" },
  recordingCtaPrimaryText: { color: "#bfdbfe", fontSize: 12, fontWeight: "800" },
  recordingCtaDanger: { backgroundColor: "rgba(127,29,29,0.2)", borderColor: "rgba(248,113,113,0.28)" },
  recordingCtaDangerText: { color: "#fda4af", fontSize: 12, fontWeight: "800" },
  deleteModalOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22, backgroundColor: "rgba(2,6,23,0.78)" },
  deleteModalCard: { width: "100%", maxWidth: 420, gap: 12, padding: 18, borderRadius: 18, backgroundColor: "#111b2b", borderWidth: 1, borderColor: "rgba(148,163,184,0.2)" },
  deleteModalActions: { width: "100%", flexDirection: "row", gap: 9, marginTop: 3 },
  renameInput: { width: "100%", minWidth: 0, minHeight: 42, backgroundColor: "#0b1220", borderColor: "#334155", borderWidth: 1, borderRadius: 10, color: "#f8fafc", paddingHorizontal: 12, fontSize: 14 },
  disabled: { opacity: 0.48 },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 19 },
  infoRow: { minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  infoLabel: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  infoValue: { color: "#e2e8f0", fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  metric: { gap: 7, marginTop: 3 },
  metricHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  metricText: { color: "#cbd5e1", fontSize: 12, fontWeight: "700" },
  track: { height: 7, borderRadius: 6, overflow: "hidden", backgroundColor: "#28364b" },
  fill: { height: "100%", borderRadius: 6 },
  footnote: { color: "#718198", fontSize: 11, marginTop: 1 },
  secondaryButton: { alignSelf: "flex-start", minHeight: 40, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  secondaryButtonText: { color: "#dbeafe", fontSize: 13, fontWeight: "700" },
  taskRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderTopColor: "#25344a", borderTopWidth: 1, paddingTop: 8 },
  taskDetails: { flex: 1, minWidth: 0, gap: 3 },
  taskName: { color: "#e2e8f0", fontSize: 14, fontWeight: "800" },
  taskMeta: { color: "#94a3b8", fontSize: 11 },
  endButton: { minWidth: 62, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#42202b", borderColor: "#7f1d35", borderWidth: 1 },
  endButtonText: { color: "#fda4af", fontSize: 12, fontWeight: "800" },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 11, borderTopColor: "#25344a", borderTopWidth: 1 },
  noteContent: { flex: 1, minWidth: 0, gap: 3 },
  noteActions: { alignItems: "flex-end", gap: 8 },
  noteName: { color: "#f8fafc", fontSize: 14, fontWeight: "800" },
  notePreview: { color: "#9aa9bc", fontSize: 12, lineHeight: 17 },
  deleteText: { color: "#fda4af", fontSize: 12, fontWeight: "700", padding: 5 },
  sendText: { color: "#93c5fd", fontSize: 12, fontWeight: "700", padding: 5 },
  actionDisabled: { opacity: 0.4 },
  loader: { marginVertical: 8 },
});
