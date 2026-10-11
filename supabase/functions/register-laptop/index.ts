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

async function generateSecureToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { token, tokenHash };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

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

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing server configuration");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  // 1. Authenticate the caller and verify user identity using their JWT
  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }

  // 2. Parse and validate payload
  let body: { name?: unknown; platform?: unknown };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body?.name !== "string") {
    return jsonResponse({ error: "A valid laptop name is required" }, 400);
  }

  const trimmedName = body.name.trim();

  if (trimmedName.length < 1 || trimmedName.length > 50) {
    return jsonResponse(
      { error: "Laptop name must be between 1 and 50 characters" },
      400
    );
  }

  const platform =
    typeof body.platform === "string" && body.platform.trim().length > 0
      ? body.platform.trim().slice(0, 20)
      : "windows";

  // 3. Initialize server-side admin client for secure credential management
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // Check for duplicate laptop name under this account
    const { data: existingDevice, error: checkError } = await admin
      .from("devices")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", trimmedName)
      .maybeSingle();

    if (checkError) {
      console.error("Device check failed:", checkError.message);
      return jsonResponse({ error: "Could not verify device availability" }, 500);
    }

    if (existingDevice) {
      return jsonResponse(
        { error: "A laptop with this name is already registered to your account." },
        409
      );
    }

    // Rate-limiting guard: reasonable maximum of 25 devices per user
    const { count, error: countError } = await admin
      .from("devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countError) {
      console.error("Device count check failed:", countError.message);
    } else if (typeof count === "number" && count >= 25) {
      return jsonResponse(
        { error: "Maximum device limit reached for this account." },
        400
      );
    }

    // 4. Generate high-entropy 32-byte token and SHA-256 hash
    const { token, tokenHash } = await generateSecureToken();

    // 5. Insert device record
    const { data: device, error: deviceInsertError } = await admin
      .from("devices")
      .insert({
        user_id: user.id,
        name: trimmedName,
        platform,
      })
      .select("id, name, platform, last_seen_at")
      .single();

    if (deviceInsertError || !device) {
      console.error("Device registration insert failed:", deviceInsertError?.message);
      return jsonResponse({ error: "Failed to register laptop" }, 500);
    }

    // 6. Insert device agent credential (with atomic rollback on failure)
    const { error: credInsertError } = await admin
      .from("device_agent_credentials")
      .insert({
        device_id: device.id,
        user_id: user.id,
        token_hash: tokenHash,
      });

    if (credInsertError) {
      console.error(
        "Device credential provisioning failed; rolling back device record:",
        credInsertError.message
      );

      // Best-effort compensating cleanup: remove newly created device record
      // to avoid leaving an orphaned device record without credentials.
      try {
        const { error: rollbackError } = await admin
          .from("devices")
          .delete()
          .eq("id", device.id)
          .eq("user_id", user.id);

        if (rollbackError) {
          console.error(
            "Compensating cleanup failed to delete orphaned device record:",
            rollbackError.message
          );
        }
      } catch (rollbackException) {
        console.error(
          "Exception during compensating device deletion:",
          rollbackException instanceof Error
            ? rollbackException.message
            : "Unknown cleanup error"
        );
      }

      return jsonResponse({ error: "Failed to provision laptop credential" }, 500);
    }

    // 7. Return plaintext token ONCE in the response over HTTPS
    // Plaintext token is never logged, never saved in DB, and never returned again.
    return jsonResponse(
      {
        success: true,
        device: {
          id: device.id,
          name: device.name,
          platform: device.platform,
        },
        token,
      },
      201
    );
  } catch (error) {
    console.error(
      "Laptop registration exception:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

