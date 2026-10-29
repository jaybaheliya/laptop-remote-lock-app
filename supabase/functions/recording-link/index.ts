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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getServiceKey();
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !serviceKey || !publicKey) return jsonResponse({ error: "Server configuration error" }, 500);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Authentication required" }, 401);
  const userClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: "Invalid or expired session" }, 401);

  let body: { command_id?: string; download?: boolean; file_name?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  if (typeof body.command_id !== "string" || !uuidPattern.test(body.command_id)) {
    return jsonResponse({ error: "A valid recording id is required" }, 400);
  }

  const { data: command, error: commandError } = await userClient
    .from("commands").select("id,device_id,action,status,result")
    .eq("id", body.command_id).eq("user_id", user.id).eq("action", "screen_record").maybeSingle();
  if (commandError) return jsonResponse({ error: "Could not verify recording access" }, 500);
  const result = command?.result as { storage_path?: unknown; file_name?: unknown } | null;
  if (!command || command.status !== "completed" || typeof result?.storage_path !== "string" || result.storage_path !== `${command.device_id}/${command.id}.mp4`) {
    return jsonResponse({ error: "This recording is not available for this account" }, 404);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const downloadName = typeof body.file_name === "string"
    ? `${body.file_name.replace(/[^a-zA-Z0-9 _.-]/g, "_").replace(/\.mp4$/i, "").slice(0, 80) || "Screen recording"}.mp4`
    : "Screen recording.mp4";
  const { data, error } = await admin.storage.from("screen-recordings").createSignedUrl(
    result.storage_path,
    600,
    body.download === true ? { download: downloadName } : undefined,
  );
  if (error || !data?.signedUrl) return jsonResponse({ error: "Could not create a private recording link" }, 500);
  return jsonResponse({ signed_url: data.signedUrl, file_name: typeof result.file_name === "string" ? result.file_name : "Screen recording.mp4" });
});
