const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

if (process.platform !== "win32") {
  console.error("This agent is intended for Windows.");
  process.exit(1);
}

// -------------------------------------------------------------
// Configuration Resolution Hierarchy
// -------------------------------------------------------------
function resolveConfig() {
  const argv = process.argv;
  let cliConfigDir = null;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--config" && i + 1 < argv.length) {
      cliConfigDir = argv[i + 1];
      i++;
    } else if (argv[i].startsWith("--config=")) {
      cliConfigDir = argv[i].slice("--config=".length);
    }
  }

  // 1. Explicit CLI argument --config <dir>
  if (cliConfigDir) {
    const configPath = path.resolve(cliConfigDir, "config.json");
    if (!fs.existsSync(configPath)) {
      console.error(`Specified config file does not exist: ${configPath}`);
      process.exit(1);
    }
    return loadConfigFile(configPath, path.resolve(cliConfigDir));
  }

  // 2. Explicit LAPTOP_LOCK_CONFIG_DIR environment variable
  const envConfigDir = process.env.LAPTOP_LOCK_CONFIG_DIR;
  if (envConfigDir && envConfigDir.trim().length > 0) {
    const configPath = path.resolve(envConfigDir.trim(), "config.json");
    if (!fs.existsSync(configPath)) {
      console.error(`Environment-specified config file does not exist: ${configPath}`);
      process.exit(1);
    }
    return loadConfigFile(configPath, path.resolve(envConfigDir.trim()));
  }

  // 3. Standard LocalAppData directory (%LOCALAPPDATA%\LaptopLockAgent\config.json)
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const defaultAppDataDir = path.join(localAppData, "LaptopLockAgent");
    const defaultAppDataConfig = path.join(defaultAppDataDir, "config.json");
    if (fs.existsSync(defaultAppDataConfig)) {
      return loadConfigFile(defaultAppDataConfig, defaultAppDataDir);
    }
  }

  // 4. Fallback to legacy configuration (preserving existing working laptop!)
  return loadLegacyConfig();
}

function loadConfigFile(filePath, configDir) {
  let rawJson;
  try {
    rawJson = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`Could not read configuration file: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    const trimmed = rawJson.trim();
    if (trimmed.startsWith("{")) {
      parsed = JSON.parse(trimmed);
    } else {
      // Decode Base64 string into UTF-8 JSON
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      parsed = JSON.parse(decoded);
    }
  } catch {
    console.error(`Invalid configuration or unreadable JSON in: ${filePath}`);
    process.exit(1);
  }

  if (typeof parsed !== "object" || parsed === null) {
    console.error(`Configuration file must be a JSON object: ${filePath}`);
    process.exit(1);
  }

  const deviceId = typeof parsed.deviceId === "string" ? parsed.deviceId.trim() : "";
  const supabaseUrl = typeof parsed.supabaseUrl === "string" ? parsed.supabaseUrl.trim() : "";
  const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
  const supabasePublishableKey =
    typeof parsed.supabasePublishableKey === "string" && parsed.supabasePublishableKey.trim().length > 0
      ? parsed.supabasePublishableKey.trim()
      : process.env.SUPABASE_PUBLISHABLE_KEY || "";

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!deviceId || !UUID_REGEX.test(deviceId)) {
    console.error("Missing or invalid 'deviceId' in configuration (must be a valid UUID).");
    process.exit(1);
  }

  if (!supabaseUrl || !supabaseUrl.startsWith("https://")) {
    console.error("Missing or invalid 'supabaseUrl' in configuration (must be a secure HTTPS URL).");
    process.exit(1);
  }

  try {
    new URL(supabaseUrl);
  } catch {
    console.error("Malformed 'supabaseUrl' in configuration.");
    process.exit(1);
  }

  if (!token) {
    console.error("Missing or empty 'token' in configuration.");
    process.exit(1);
  }

  if (!supabasePublishableKey) {
    console.error("Missing Supabase publishable key in config or SUPABASE_PUBLISHABLE_KEY environment variable.");
    process.exit(1);
  }

  const testMode = typeof parsed.testMode === "boolean" ? parsed.testMode : false;
  let pollIntervalMs = 5000;
  if (
    typeof parsed.pollIntervalMs === "number" &&
    Number.isFinite(parsed.pollIntervalMs) &&
    parsed.pollIntervalMs >= 1000 &&
    parsed.pollIntervalMs <= 60000
  ) {
    pollIntervalMs = Math.floor(parsed.pollIntervalMs);
  }

  return {
    deviceId,
    supabaseUrl,
    supabasePublishableKey,
    deviceToken: token,
    testMode,
    pollIntervalMs,
    configDir,
    pidFile: path.join(configDir, ".agent.pid"),
    isLegacy: false,
  };
}

function loadLegacyConfig() {
  const legacyTokenPath = path.join(__dirname, ".agent-token");

  if (!fs.existsSync(legacyTokenPath)) {
    console.error("Missing .agent-token file.");
    process.exit(1);
  }

  const deviceToken = fs.readFileSync(legacyTokenPath, "utf8").trim();

  if (!deviceToken) {
    console.error("The device token file is empty.");
    process.exit(1);
  }

  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabasePublishableKey) {
    console.error("Missing SUPABASE_PUBLISHABLE_KEY environment variable.");
    process.exit(1);
  }

  return {
    deviceId: "0ec98747-7031-4f32-be13-d06c90dd5015",
    supabaseUrl: "https://nsbrejxbfuxgipfqhtru.supabase.co",
    supabasePublishableKey,
    deviceToken,
    testMode: false,
    pollIntervalMs: 5000,
    configDir: __dirname,
    pidFile: path.join(__dirname, ".agent.pid"),
    isLegacy: true,
  };
}

const config = resolveConfig();
const SUPABASE_URL = config.supabaseUrl;
const DEVICE_ID = config.deviceId;
const POLL_INTERVAL_MS = config.pollIntervalMs;
const TEST_MODE = config.testMode;
const deviceToken = config.deviceToken;
const PID_FILE = config.pidFile;

// Single-instance enforcement: ensure only one agent process runs at a time
function acquirePidLock() {
  if (fs.existsSync(PID_FILE)) {
    try {
      const existingPid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
      if (!isNaN(existingPid) && existingPid !== process.pid) {
        try {
          // Signal 0 verifies process existence without killing it
          process.kill(existingPid, 0);
          console.log(
            `Another agent instance is already running (PID: ${existingPid}). Exiting duplicate process.`
          );
          process.exit(0);
        } catch {
          // Process does not exist; lock is stale
          console.log(`Clearing stale PID file from previous PID ${existingPid}.`);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  try {
    fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
  } catch (err) {
    console.error("Could not write PID lock file:", err.message);
  }
}

function releasePidLock() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const current = fs.readFileSync(PID_FILE, "utf8").trim();
      if (current === String(process.pid)) {
        fs.unlinkSync(PID_FILE);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

acquirePidLock();

let busy = false;
let stopped = false;

async function callAgentPoll(body) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/agent-poll`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabasePublishableKey,
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Agent API returned HTTP ${response.status}: ${
        result.error || "Request failed"
      }`
    );
  }

  return result;
}

function lockWindows() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "rundll32.exe",
      ["user32.dll,LockWorkStation"],
      {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      }
    );

    child.once("error", reject);

    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`Windows lock command exited with code ${code}`)
        );
      }
    });
  });
}

async function pollOnce() {
  if (busy || stopped) return;

  busy = true;

  try {
    const result = await callAgentPoll({ action: "poll" });
    const command = result.command;

    if (!command) return;

    if (
      command.action !== "lock" ||
      command.device_id !== DEVICE_ID
    ) {
      console.error(
        `Unexpected command received (${command.action} for ${command.device_id}). Expected lock for ${DEVICE_ID}.`
      );
      return;
    }

    console.log("Lock command received:", command.id);

    // Safe mode: do not lock Windows or change command status.
    if (TEST_MODE) {
      console.log(
        "[SAFE TEST MODE] Command received. Windows will NOT be locked."
      );
      console.log(
        "[SAFE TEST MODE] Command remains claimed for inspection."
      );
      return;
    }

    let status = "completed";
    let failureReason = null;

    try {
      console.log("Locking Windows...");
      await lockWindows();
      console.log("Windows lock request sent.");
    } catch (error) {
      status = "failed";
      failureReason =
        error instanceof Error ? error.message : "Windows lock execution failed";
      console.error("Could not lock Windows:", failureReason);
    }

    const payload = {
      action: "complete",
      command_id: command.id,
      status,
    };

    if (failureReason) {
      // Sanitize failure reason (strip non-printable characters, limit to 255 chars)
      payload.failure_reason = failureReason
        .replace(/[^\x20-\x7E]/g, "")
        .trim()
        .slice(0, 255);
    }

    await callAgentPoll(payload);

    console.log(`Command status reported: ${status}`);
  } catch (error) {
    console.error("Agent connection error:", error.message);
  } finally {
    busy = false;
  }
}

console.log("Laptop agent started.");
console.log("Config Mode:", config.isLegacy ? "Legacy (.agent-token)" : `Custom (${config.configDir})`);
console.log("Device:", DEVICE_ID);
console.log("Process PID:", process.pid);
console.log(`PID Lock File: ${PID_FILE}`);
console.log(`Polling interval: ${POLL_INTERVAL_MS / 1000} seconds.`);
console.log("Safe test mode:", TEST_MODE ? "ON" : "OFF");

if (TEST_MODE) {
  console.log("Windows locking is DISABLED.");
}

void pollOnce();

const timer = setInterval(() => {
  void pollOnce();
}, POLL_INTERVAL_MS);

function shutdown() {
  if (stopped) return;

  stopped = true;
  clearInterval(timer);
  releasePidLock();
  console.log("Laptop agent stopped.");
}

process.once("exit", releasePidLock);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
