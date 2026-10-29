import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment configuration.");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // Verify the signed-in user.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }

  let body: { device_id?: string; action?: string; payload?: Record<string, unknown> };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const deviceId = body?.device_id;
  const requestedAction = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "lock";

  const ALLOWED_ACTIONS = ["lock", "sleep", "shutdown", "screenshot", "unlock", "panic", "display_message", "task_list", "end_task", "refresh_status", "save_note", "screen_record", "rename_recording"];
  if (!ALLOWED_ACTIONS.includes(requestedAction)) {
    return jsonResponse({ error: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(", ")}` }, 400);
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (typeof deviceId !== "string" || !uuidPattern.test(deviceId)) {
    return jsonResponse({ error: "A valid device_id is required" }, 400);
  }

  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload
    : {};
  if (JSON.stringify(payload).length > 6000) {
    return jsonResponse({ error: "Command payload is too large" }, 400);
  }
  if (requestedAction === "display_message" && (typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 500)) {
    return jsonResponse({ error: "A message of 1 to 500 characters is required" }, 400);
  }
  if (requestedAction === "end_task" && (!Number.isInteger(payload.process_id) || Number(payload.process_id) <= 0)) {
    return jsonResponse({ error: "A valid process ID is required" }, 400);
  }
  if (requestedAction === "end_task" && (typeof payload.process_name !== "string" || !payload.process_name.trim() || payload.process_name.length > 100)) {
    return jsonResponse({ error: "A valid process name is required" }, 400);
  }
  if (requestedAction === "save_note" && (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 100 || typeof payload.body !== "string" || !payload.body.trim() || payload.body.length > 5000)) {
    return jsonResponse({ error: "A note title and body are required" }, 400);
  }
  if (requestedAction === "screen_record" && !["start", "stop", "status"].includes(String(payload.mode))) {
    return jsonResponse({ error: "Recording mode must be start, stop, or status" }, 400);
  }
  if (requestedAction === "screen_record" && payload.mode === "start" && (typeof payload.name !== "string" || !payload.name.trim() || payload.name.length > 80 || typeof payload.send_to_phone !== "boolean" || (payload.max_seconds != null && (!Number.isInteger(payload.max_seconds) || Number(payload.max_seconds) < 15 || Number(payload.max_seconds) > 60)))) {
    return jsonResponse({ error: "Recording needs a name, send choice, and a 15 to 60 second limit" }, 400);
  }
  if (requestedAction === "rename_recording" && (typeof payload.recording_id !== "string" || !uuidPattern.test(payload.recording_id) || typeof payload.file_name !== "string" || !payload.file_name.toLowerCase().endsWith(".mp4") || typeof payload.new_name !== "string" || !payload.new_name.trim() || payload.new_name.length > 80)) {
    return jsonResponse({ error: "A saved recording and a new name are required" }, 400);
  }

  // Verify that this device belongs to the signed-in user.
  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id")
    .eq("id", deviceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (deviceError) {
    console.error("Device lookup failed:", deviceError.message);
    return jsonResponse({ error: "Could not verify device ownership" }, 500);
  }

  if (!device) {
    return jsonResponse({ error: "Device not found" }, 404);
  }

  // Create a pending command under the user's permissions and RLS.
  const { data: command, error: insertError } = await supabase
    .from("commands")
    .insert({
      device_id: deviceId,
      user_id: user.id,
      action: requestedAction,
      status: "pending",
      payload,
    })
    .select("id, device_id, action, status, created_at, payload")
    .single();

  if (insertError) {
    console.error("Command insert failed:", insertError.message);
    return jsonResponse(
      { error: "Could not create command. Check table permissions." },
      403
    );
  }

  return jsonResponse({ success: true, command });
});
