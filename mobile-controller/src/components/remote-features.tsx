import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
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
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [appsExpanded, setAppsExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);

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
