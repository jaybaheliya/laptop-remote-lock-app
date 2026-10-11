import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
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

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  let serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceRoleKey) {
    try {
      const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
      if (secretKeysJson) {
        const secretKeys = JSON.parse(secretKeysJson);
        serviceRoleKey = secretKeys["default"] ?? secretKeys["service_role"];
      }
    } catch {
      console.error("Could not parse SUPABASE_SECRET_KEYS.");
    }
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing server configuration (SUPABASE_URL or service-role key)");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const authorization = req.headers.get("Authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1];

  if (!token) {
    return jsonResponse({ error: "Device authentication required" }, 401);
  }

  let body: {
    action?: string;
    command_id?: string;
    status?: string;
    failure_reason?: string;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (body.action !== "poll" && body.action !== "complete") {
    return jsonResponse({ error: "Invalid action" }, 400);
  }

  if (
    body.action === "complete" &&
    (typeof body.command_id !== "string" ||
      !uuidPattern.test(body.command_id) ||
      !["completed", "failed"].includes(body.status ?? ""))
  ) {
    return jsonResponse(
      { error: "Valid command_id and status are required" },
      400
    );
  }

  // The service-role key stays on the server only.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // Authenticate this laptop using its stored token hash.
    const tokenHash = await hashToken(token);

    const { data: credential, error: credentialError } = await admin
      .from("device_agent_credentials")
      .select("device_id, user_id")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (credentialError) {
      console.error("Credential lookup failed:", credentialError.message);
      return jsonResponse({ error: "Authentication unavailable" }, 500);
    }

    if (!credential) {
      return jsonResponse({ error: "Invalid device token" }, 401);
    }

    const deviceId = credential.device_id;
    const userId = credential.user_id;

    const heartbeatTime = new Date().toISOString();

    const [credResult, deviceResult] = await Promise.all([
      admin
        .from("device_agent_credentials")
        .update({ last_seen_at: heartbeatTime })
        .eq("device_id", deviceId)
        .eq("user_id", userId),
      admin
        .from("devices")
        .update({ last_seen_at: heartbeatTime })
        .eq("id", deviceId)
        .eq("user_id", userId),
    ]);

    if (credResult.error) {
      console.error(
        "Credential heartbeat update failed:",
        credResult.error.message
      );
    }

    if (deviceResult.error) {
      console.error(
        "Device heartbeat update failed:",
        deviceResult.error.message
      );
    }

    if (body.action === "poll") {
      // Find the oldest pending lock command for this laptop.
      const { data: pending, error: pendingError } = await admin
        .from("commands")
        .select("id, device_id, action, status, created_at")
        .eq("device_id", deviceId)
        .eq("user_id", userId)
        .eq("action", "lock")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (pendingError) {
        console.error("Command lookup failed:", pendingError.message);
        return jsonResponse({ error: "Could not retrieve command" }, 500);
      }

      if (!pending) {
        return jsonResponse({ success: true, command: null });
      }

      // Claim only if the command is still pending.
      const { data: claimed, error: claimError } = await admin
        .from("commands")
        .update({ status: "claimed" })
        .eq("id", pending.id)
        .eq("device_id", deviceId)
        .eq("user_id", userId)
        .eq("status", "pending")
        .select("id, device_id, action, status, created_at")
        .maybeSingle();

      if (claimError) {
        console.error("Command claim failed:", claimError.message);
        return jsonResponse({ error: "Could not claim command" }, 500);
      }

      // Another poll may have claimed it first.
      return jsonResponse({ success: true, command: claimed ?? null });
    }

    // A device can complete only a command assigned to itself.
    const updatePayload: Record<string, unknown> = {
      status: body.status,
    };

    if (typeof body.failure_reason === "string" && body.status === "failed") {
      updatePayload.failure_reason = body.failure_reason
        .replace(/[^\x20-\x7E]/g, "")
        .trim()
        .slice(0, 255);
    }

    let { data: updated, error: updateError } = await admin
      .from("commands")
      .update(updatePayload)
      .eq("id", body.command_id!)
      .eq("device_id", deviceId)
      .eq("user_id", userId)
      .eq("status", "claimed")
      .select("id, device_id, action, status, created_at")
      .maybeSingle();

    if (updateError && updateError.message?.includes("failure_reason")) {
      const fallback = await admin
        .from("commands")
        .update({ status: body.status })
        .eq("id", body.command_id!)
        .eq("device_id", deviceId)
        .eq("user_id", userId)
        .eq("status", "claimed")
        .select("id, device_id, action, status, created_at")
        .maybeSingle();

      updated = fallback.data;
      updateError = fallback.error;
    }

    if (updateError) {
      console.error("Command completion failed:", updateError.message);
      return jsonResponse({ error: "Could not update command" }, 500);
    }

    if (!updated) {
      return jsonResponse(
        { error: "Command not found or no longer claimable" },
        404
      );
    }

    return jsonResponse({ success: true, command: updated });
  } catch (error) {
    console.error(
      "Agent request failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
