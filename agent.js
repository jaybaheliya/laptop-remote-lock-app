const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
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
  const unlockPassword =
    typeof parsed.unlockPassword === "string" && parsed.unlockPassword.trim().length > 0
      ? parsed.unlockPassword.trim()
      : null;
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
    unlockPassword,
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

let config = resolveConfig();
let SUPABASE_URL = config.supabaseUrl;
let DEVICE_ID = config.deviceId;
let POLL_INTERVAL_MS = config.pollIntervalMs;
let TEST_MODE = config.testMode;
let deviceToken = config.deviceToken;
let PID_FILE = config.pidFile;

function reloadConfigIfChanged() {
  try {
    const newConfig = resolveConfig();
    if (
      newConfig.deviceToken !== deviceToken ||
      newConfig.deviceId !== DEVICE_ID ||
      newConfig.supabaseUrl !== SUPABASE_URL
    ) {
      console.log(`Configuration update detected. Switching to device: ${newConfig.deviceId}`);
      config = newConfig;
      SUPABASE_URL = newConfig.supabaseUrl;
      DEVICE_ID = newConfig.deviceId;
      POLL_INTERVAL_MS = newConfig.pollIntervalMs;
      TEST_MODE = newConfig.testMode;
      deviceToken = newConfig.deviceToken;
    }
  } catch (err) {
    // Keep running with existing config if file is temporarily being written
  }
}

// Single-instance enforcement: atomic Windows Named Pipe lock (immune to PID recycling)
let instanceServer = null;

function enforceSingleInstance() {
  const pipeName = "\\\\.\\pipe\\laptop-lock-agent-v1-lock";
  try {
    instanceServer = net.createServer();
    instanceServer.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log("[INSTANCE] Another active agent instance is running. Exiting duplicate process.");
        process.exit(0);
      }
    });

    instanceServer.listen(pipeName, () => {
      instanceServer.unref();
    });
  } catch (err) {
    console.warn("[INSTANCE] Named pipe check skipped:", err.message);
  }

  // Record PID file for administrative / task-manager visibility
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
  } catch (err) {
    console.error("Could not write PID lock file:", err.message);
  }
}

function releaseSingleInstance() {
  try {
    if (instanceServer) {
      instanceServer.close();
      instanceServer = null;
    }
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

enforceSingleInstance();

let busy = false;
let busySince = 0;
let stopped = false;
let consecutiveAuthErrors = 0;

async function callAgentPoll(body) {
  // Check if config.json was updated on disk before polling
  reloadConfigIfChanged();

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
    if (response.status === 401) {
      consecutiveAuthErrors++;
      reloadConfigIfChanged();
      console.warn(`[AUTH] Device token authentication returned 401 (attempt ${consecutiveAuthErrors}). Backing off before retry.`);
      // Prevent rapid hammering if credentials are being rotated
      await new Promise((r) => setTimeout(r, Math.min(30000, consecutiveAuthErrors * 5000)));
    }
    throw new Error(
      `Agent API returned HTTP ${response.status}: ${
        result.error || "Request failed"
      }`
    );
  }

  consecutiveAuthErrors = 0;
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

function sleepWindows() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)",
      ],
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
          new Error(`Windows sleep command exited with code ${code}`)
        );
      }
    });
  });
}

function shutdownWindows() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "shutdown.exe",
      ["/s", "/t", "10", "/c", "Remote shutdown requested via Laptop Lock App"],
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
          new Error(`Windows shutdown command exited with code ${code}`)
        );
      }
    });
  });
}

function getCaptureScriptPath() {
  const scriptPath = path.join(os.tmpdir(), "win_screen_capture.ps1");
  const scriptContent = `param([string]$OutputPath)
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class Win32Capture {
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
    [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);

    public static void SaveScreen(string path) {
        int w = GetSystemMetrics(0);
        int h = GetSystemMetrics(1);
        IntPtr hWnd = GetDesktopWindow();
        IntPtr hDeskDC = GetWindowDC(hWnd);
        IntPtr hMemDC = CreateCompatibleDC(hDeskDC);
        IntPtr hBmp = CreateCompatibleBitmap(hDeskDC, w, h);
        IntPtr hOld = SelectObject(hMemDC, hBmp);
        BitBlt(hMemDC, 0, 0, w, h, hDeskDC, 0, 0, 0x00CC0020);
        using (Bitmap bmp = Image.FromHbitmap(hBmp)) {
            bmp.Save(path, ImageFormat.Jpeg);
        }
        SelectObject(hMemDC, hOld);
        DeleteObject(hBmp);
        DeleteDC(hMemDC);
        ReleaseDC(hWnd, hDeskDC);
    }
}
"@ -ReferencedAssemblies System.Drawing

[Win32Capture]::SaveScreen($OutputPath)
`;
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, scriptContent, "utf8");
  }
  return scriptPath;
}

function captureScreen() {
  return new Promise((resolve, reject) => {
    try {
      const scriptPath = getCaptureScriptPath();
      const tempOutput = path.join(os.tmpdir(), `cap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`);

      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-OutputPath", tempOutput],
        { shell: false, windowsHide: true }
      );

      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

      child.once("close", (code) => {
        if (code === 0 && fs.existsSync(tempOutput)) {
          try {
            const imgBuffer = fs.readFileSync(tempOutput);
            const base64Data = "data:image/jpeg;base64," + imgBuffer.toString("base64");
            try { fs.unlinkSync(tempOutput); } catch {}
            resolve(base64Data);
            return;
          } catch (readErr) {
            reject(new Error("Could not read screenshot file: " + readErr.message));
            return;
          }
        }
        reject(new Error(`Screenshot capture failed (code ${code}): ${stderr.trim() || "Unknown error"}`));
      });

      child.once("error", (err) => {
        reject(new Error(`Screenshot process spawn failed: ${err.message}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

function getUnlockScriptPath() {
  const scriptPath = path.join(os.tmpdir(), "win_unlock_worker.ps1");
  const scriptContent = `param([string]$PasswordBase64 = "", [string]$Password = "")
$ErrorActionPreference = "Stop"

if (![string]::IsNullOrEmpty($PasswordBase64)) {
    try {
        $bytes = [System.Convert]::FromBase64String($PasswordBase64)
        $Password = [System.Text.Encoding]::UTF8.GetString($bytes)
    } catch {}
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class WinSendInputUnlocker {
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUT {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KEYBDINPUT ki;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    static extern short VkKeyScan(char ch);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    public static void SendKey(ushort vk) {
        byte scan = (byte)MapVirtualKey(vk, 0);

        int inputSize = Marshal.SizeOf(typeof(INPUT));
        INPUT[] inputs = new INPUT[2];

        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = vk;
        inputs[0].ki.wScan = scan;
        inputs[0].ki.dwFlags = 0;

        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wVk = vk;
        inputs[1].ki.wScan = scan;
        inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;

        // Dual dispatch: SendInput (modern) + keybd_event (legacy Winlogon fallback)
        SendInput(1, new INPUT[] { inputs[0] }, inputSize);
        keybd_event((byte)vk, scan, 0, 0);
        Thread.Sleep(50);
        SendInput(1, new INPUT[] { inputs[1] }, inputSize);
        keybd_event((byte)vk, scan, KEYEVENTF_KEYUP, 0);
        Thread.Sleep(50);
    }

    public static void SendUnicode(char c) {
        int inputSize = Marshal.SizeOf(typeof(INPUT));
        INPUT[] inputs = new INPUT[2];

        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = 0;
        inputs[0].ki.wScan = (ushort)c;
        inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;

        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wVk = 0;
        inputs[1].ki.wScan = (ushort)c;
        inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

        SendInput(1, new INPUT[] { inputs[0] }, inputSize);
        Thread.Sleep(50);
        SendInput(1, new INPUT[] { inputs[1] }, inputSize);
        Thread.Sleep(50);
    }

    public static void SendChar(char c) {
        short scanResult = VkKeyScan(c);
        if (scanResult == -1) {
            SendUnicode(c);
            return;
        }

        byte vk = (byte)(scanResult & 0xFF);
        int shiftState = (scanResult >> 8) & 0xFF;
        bool needShift = (shiftState & 1) != 0;

        if (needShift) {
            byte shiftScan = (byte)MapVirtualKey(0x10, 0);
            keybd_event(0x10, shiftScan, 0, 0);
            Thread.Sleep(30);
        }

        SendKey(vk);

        if (needShift) {
            byte shiftScan = (byte)MapVirtualKey(0x10, 0);
            keybd_event(0x10, shiftScan, KEYEVENTF_KEYUP, 0);
            Thread.Sleep(30);
        }
    }

    public static void Unlock(string password) {
        // Step 1: Wake display with mouse movement
        mouse_event(0x0001, 30, 30, 0, 0);
        Thread.Sleep(80);
        mouse_event(0x0001, -30, -30, 0, 0);
        Thread.Sleep(500);

        // Step 2: Dismiss lock screen clock curtain by sending Space then Enter
        SendKey(0x20); // Spacebar to trigger slide-up
        Thread.Sleep(200);
        SendKey(0x0D); // Enter to focus PIN credential field
        Thread.Sleep(2000); // 2000ms gives Windows 11 full time to finish animation and activate field

        // Step 3: Type password characters (do NOT send backspaces)
        if (!string.IsNullOrEmpty(password)) {
            foreach (char c in password) {
                SendChar(c);
                Thread.Sleep(85); // 85ms spacing between characters
            }
            Thread.Sleep(500);

            // Step 4: Submit password
            SendKey(0x0D);
        }
    }
}
"@

[WinSendInputUnlocker]::Unlock($Password)
`;
  fs.writeFileSync(scriptPath, scriptContent, "utf8");
  return scriptPath;
}

function unlockOrWakeWindows(unlockPassword) {
  return new Promise((resolve, reject) => {
    try {
      const scriptPath = getUnlockScriptPath();
      const pwdArg = typeof unlockPassword === "string" ? unlockPassword.trim() : "";
      const pwdBase64 = pwdArg ? Buffer.from(pwdArg, "utf8").toString("base64") : "";

      const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
      if (pwdBase64) {
        args.push("-PasswordBase64", pwdBase64);
      }

      const child = spawn("powershell.exe", args, { shell: false, windowsHide: true });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

      child.once("close", (code) => {
        if (code === 0 && !stderr.includes("Error") && !stderr.includes("Exception")) {
          resolve();
        } else {
          reject(new Error(`Wake/unlock command failed (exit ${code}): ${stderr.trim() || stdout.trim()}`));
        }
      });
      child.once("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

const ALLOWED_ACTIONS = ["lock", "sleep", "shutdown", "screenshot", "unlock"];

let cachedBattery = null;
let lastBatteryFetchTime = 0;

function getBatteryStatus() {
  const now = Date.now();
  // Cache for 15 seconds to avoid spawning PowerShell on every 5s poll cycle
  if (cachedBattery && now - lastBatteryFetchTime < 15000) {
    return Promise.resolve(cachedBattery);
  }

  return new Promise((resolve) => {
    const psScript = "& { $b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; $s = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue; if ($b) { [PSCustomObject]@{ level = [int]$b.EstimatedChargeRemaining; is_charging = [bool]($s.Charging -or $s.PowerOnline); power_online = [bool]$s.PowerOnline } | ConvertTo-Json -Compress } else { [PSCustomObject]@{ level = 100; is_charging = $false; power_online = $true } | ConvertTo-Json -Compress } }";

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { shell: false, windowsHide: true }
    );

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.once("close", (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim());
          cachedBattery = {
            level: typeof parsed.level === "number" ? parsed.level : null,
            is_charging: Boolean(parsed.is_charging),
            power_online: Boolean(parsed.power_online),
          };
          lastBatteryFetchTime = now;
          resolve(cachedBattery);
          return;
        } catch {
          // Keep previous cache if parse fails
        }
      }
      resolve(cachedBattery);
    });

    child.once("error", () => {
      resolve(cachedBattery);
    });
  });
}

async function pollOnce() {
  if (busy || stopped) return;

  busy = true;

  try {
    const battery = await getBatteryStatus();
    const result = await callAgentPoll({ action: "poll", battery });
    const command = result.command;
    // unlock_password is returned by agent-poll when action === "unlock", or fallback to config
    const unlockPassword =
      (typeof result.unlock_password === "string" && result.unlock_password.trim().length > 0)
        ? result.unlock_password.trim()
        : (config.unlockPassword || null);

    if (!command) return;

    if (
      !ALLOWED_ACTIONS.includes(command.action) ||
      command.device_id !== DEVICE_ID
    ) {
      console.error(
        `Unexpected command received (${command.action} for ${command.device_id}). Expected one of [${ALLOWED_ACTIONS.join(", ")}] for ${DEVICE_ID}.`
      );
      return;
    }

    const action = command.action;
    console.log(`Command received: ${action} (${command.id})`);

    // Safe mode: do not execute action or change command status.
    if (TEST_MODE) {
      console.log(
        `[SAFE TEST MODE] Command received (${action}). Windows will NOT perform this action.`
      );
      console.log(
        "[SAFE TEST MODE] Command remains claimed for inspection."
      );
      return;
    }

    let status = "completed";
    let failureReason = null;
    let imageData = null;

    if (action === "sleep") {
      // For sleep, we notify Supabase that it was completed BEFORE putting the machine into sleep,
      // because network adapters suspend immediately upon sleep.
      try {
        console.log("Reporting completion before sleep...");
        await callAgentPoll({
          action: "complete",
          command_id: command.id,
          status: "completed",
        });
        console.log("Putting Windows to sleep...");
        await sleepWindows();
        return;
      } catch (error) {
        status = "failed";
        failureReason =
          error instanceof Error ? error.message : "Windows sleep execution failed";
        console.error("Could not sleep Windows:", failureReason);
      }
    } else if (action === "screenshot") {
      try {
        console.log("Capturing desktop screenshot...");
        imageData = await captureScreen();
        console.log("Desktop screenshot captured successfully.");
      } catch (error) {
        status = "failed";
        failureReason =
          error instanceof Error ? error.message : "Screen capture execution failed";
        console.error("Could not capture screen:", failureReason);
      }
    } else if (action === "unlock") {
      try {
        if (unlockPassword) {
          console.log("Sending display wake signal and typing unlock password...");
        } else {
          console.log("Sending display wake signal (no password stored — dismissing lock screen only)...");
        }
        await unlockOrWakeWindows(unlockPassword);
        console.log("Display wake/unlock signal sent successfully.");
      } catch (error) {
        status = "failed";
        failureReason =
          error instanceof Error ? error.message : "Unlock/wake execution failed";
        console.error("Could not wake/unlock Windows:", failureReason);
      }
    } else {
      try {
        if (action === "lock") {
          console.log("Locking Windows...");
          await lockWindows();
          console.log("Windows lock request sent.");
        } else if (action === "shutdown") {
          console.log("Shutting down Windows in 10 seconds...");
          await shutdownWindows();
          console.log("Windows shutdown request scheduled.");
        } else {
          throw new Error(`Unsupported action: ${action}`);
        }
      } catch (error) {
        status = "failed";
        failureReason =
          error instanceof Error ? error.message : `Windows ${action} execution failed`;
        console.error(`Could not execute ${action} on Windows:`, failureReason);
      }
    }

    const payload = {
      action: "complete",
      command_id: command.id,
      status,
    };

    if (imageData) {
      payload.image_data = imageData;
    }

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
    busySince = 0;
  }
}

console.log("Laptop agent started.");
console.log("Config Mode:", config.isLegacy ? "Legacy (.agent-token)" : `Custom (${config.configDir})`);
console.log("Device:", DEVICE_ID);
console.log("Process PID:", process.pid);
console.log(`Polling interval: ${POLL_INTERVAL_MS / 1000} seconds.`);
console.log("Safe test mode:", TEST_MODE ? "ON" : "OFF");

if (TEST_MODE) {
  console.log("Windows locking is DISABLED.");
}

void pollOnce();

const timer = setInterval(() => {
  void pollOnce();
}, POLL_INTERVAL_MS);

// --- POWER RESUME & DEADLOCK WATCHDOG ---
let lastHeartbeatTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const elapsed = now - lastHeartbeatTick;
  lastHeartbeatTick = now;

  // Normal interval is 1000ms. If elapsed > 4000ms, the system was suspended / in sleep!
  if (elapsed > 4000) {
    console.log(`[POWER RESUME] System woke from sleep (suspended for ${Math.round(elapsed / 1000)}s).`);
    busy = false;
    busySince = 0;
    consecutiveAuthErrors = 0;
    // Allow 2.5s for WiFi to re-associate, then poll immediately
    setTimeout(() => {
      console.log("[POWER RESUME] Triggering immediate poll after sleep.");
      void pollOnce();
    }, 2500);
  }

  // Deadlock watchdog: If busy has been true for > 25 seconds, clear the freeze
  if (busy && busySince > 0 && now - busySince > 25000) {
    console.warn("[WATCHDOG] Polling cycle deadlocked for >25s. Forcing reset.");
    busy = false;
    busySince = 0;
    void pollOnce();
  }
}, 1000).unref();

// Global process exception guards so agent never crashes
process.on("uncaughtException", (err) => {
  console.error("[CRITICAL UNCAUGHT EXCEPTION]", err.message);
  busy = false;
  busySince = 0;
});

process.on("unhandledRejection", (reason) => {
  console.error("[CRITICAL UNHANDLED REJECTION]", reason);
  busy = false;
  busySince = 0;
});

function shutdown() {
  if (stopped) return;

  stopped = true;
  clearInterval(timer);
  releaseSingleInstance();
  console.log("Laptop agent stopped.");
}

process.once("exit", releaseSingleInstance);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
