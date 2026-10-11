
const fs = require("node:fs");
const path = require("node:path");

async function testConnection() {
  const tokenPath = path.join(__dirname, ".agent-token");
  const token = fs.readFileSync(tokenPath, "utf8").trim();
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!token || !apiKey) {
    throw new Error("Device token or publishable key is missing.");
  }

  const response = await fetch(
    "https://nsbrejxbfuxgipfqhtru.supabase.co/functions/v1/agent-poll",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: "complete",
        command_id: "00000000-0000-4000-8000-000000000000",
        status: "failed",
      }),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (response.status === 404) {
    console.log("SUCCESS: Device authenticated; no matching test command exists.");
  } else if (response.status === 401) {
    console.log("AUTHENTICATION FAILED: Check the private device token.");
  } else if (response.status === 500) {
    console.log("SERVER ERROR: Check Edge Function secrets and logs.");
  } else {
    console.log("HTTP status:", response.status);
    console.log("Response:", result.error || "Unexpected response");
  }
}

testConnection().catch((error) => {
  console.error("Connection test failed:", error.message);
});
