import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function getServiceKey() {
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    try {
      const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      key = secretKeys.default ?? secretKeys.service_role;
    } catch { /* retain missing-key error below */ }
  }
  return key;
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getServiceKey();
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Server configuration error" }, 500);

  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return jsonResponse({ error: "Device authentication required" }, 401);

  let body: { action?: string; command_id?: string; start_command_id?: string; file_size?: number };
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  if (body.action !== "create_upload" || typeof body.command_id !== "string" || !uuidPattern.test(body.command_id) || typeof body.start_command_id !== "string" || !uuidPattern.test(body.start_command_id)) {
    return jsonResponse({ error: "A valid recording command is required" }, 400);
  }
  if (!Number.isInteger(body.file_size) || Number(body.file_size) < 1 || Number(body.file_size) > 157286400) {
    return jsonResponse({ error: "Recording must be 1 byte to 150 MB" }, 413);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: credential, error: credentialError } = await admin
    .from("device_agent_credentials").select("device_id,user_id").eq("token_hash", await hashToken(token)).maybeSingle();
  if (credentialError) return jsonResponse({ error: "Could not verify this laptop" }, 500);
  if (!credential) return jsonResponse({ error: "Invalid device token" }, 401);

  const [stopResult, startResult] = await Promise.all([
    admin.from("commands").select("id,payload,status")
      .eq("id", body.command_id).eq("device_id", credential.device_id).eq("user_id", credential.user_id)
      .eq("action", "screen_record").eq("status", "claimed").maybeSingle(),
    admin.from("commands").select("id,payload,status")
      .eq("id", body.start_command_id).eq("device_id", credential.device_id).eq("user_id", credential.user_id)
      .eq("action", "screen_record").eq("status", "completed").maybeSingle(),
  ]);
  if (stopResult.error || startResult.error) return jsonResponse({ error: "Could not verify the recording request" }, 500);
  if (!stopResult.data || stopResult.data.payload?.mode !== "stop" || !startResult.data || startResult.data.payload?.mode !== "start" || startResult.data.payload?.send_to_phone !== true) {
    return jsonResponse({ error: "This recording request cannot upload a video" }, 403);
  }

  const storagePath = `${credential.device_id}/${body.command_id}.mp4`;
  const { data, error } = await admin.storage.from("screen-recordings").createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data) {
    console.error("Signed recording upload could not be created:", error?.message);
    return jsonResponse({ error: "Could not prepare private video storage" }, 500);
  }
  return jsonResponse({ signed_url: data.signedUrl, storage_path: storagePath });
});
