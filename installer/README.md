# Laptop Remote Lock Agent — Windows Installer Build Guide

This directory packages the background Windows workstation agent into a single, clean `.exe` installer using **Inno Setup 6 (x64)**.

---

## 1. Architectural Highlights

- **Standard Per-User Scope (`PrivilegesRequired=lowest`):**
  - Installs directly to `%LOCALAPPDATA%\Programs\LaptopLockAgent`.
  - Runs with standard user privileges—**No UAC Administrator elevation required**.
  - Ensures the agent executes in the interactive user desktop session where Windows `LockWorkStation` functions correctly.
- **Portable Node.js Runtime (Zero Dependency Requirement):**
  - Works on clean Windows 10/11 machines without requiring Node.js to be installed globally on the target machine.
- **Secure Dynamic Pairing:**
  - The installer prompts for the **Pairing Key** generated when clicking **"+ Add Laptop"** on the dashboard.
  - The configuration file is stored in `%LOCALAPPDATA%\LaptopLockAgent\config.json`.
  - Restricts folder ACLs using `icacls` so only the current Windows user has read/write permissions.
- **Silent Startup Automation:**
  - Installs a per-user Task Scheduler task (`LaptopLockAgent`) configured for `ONLOGON`.
  - Launches via `start-agent-hidden.vbs` without opening an intrusive console or CMD window.
- **Clean Uninstaller:**
  - Safely stops the agent process, removes the Scheduled Task, and optionally purges stored credentials and log files.

---

## 2. Directory Layout

```text
installer/
├── bin/
│   └── node.exe                 <-- Optional: Download standalone node.exe here (for 100% standalone setup)
├── runner/
│   ├── start-agent.bat          <-- Dynamic path resolver & 5MB log rotator
│   └── start-agent-hidden.vbs   <-- Invisible VBScript runner
├── LaptopLockAgent.iss          <-- Inno Setup 6 compilation script
└── README.md                    <-- This documentation
```

---

## 3. How to Compile the Installer (.exe)

### Step 1: Install Inno Setup 6
Download and install [Inno Setup 6](https://jrsoftware.org/isdl.php) (free & open source).

### Step 2: (Optional but Recommended) Download Portable `node.exe`
To make the installer self-contained so target PCs don't need Node.js:
1. Create a `bin` folder inside `installer/`:
   ```powershell
   mkdir installer\bin
   ```
2. Download the official 64-bit `node.exe` (v20 LTS recommended):
   ```powershell
   Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/win-x64/node.exe" -OutFile "installer\bin\node.exe"
   ```
*(Note: If `installer\bin\node.exe` is omitted, the installer will compile fine and fallback to using system `node` on target PCs).*

### Step 3: Compile with Inno Setup Compiler
Run the Inno Setup command-line compiler:
```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\LaptopLockAgent.iss
```
*Or open `LaptopLockAgent.iss` in the Inno Setup GUI and click **Build -> Compile** (Ctrl+F9).*

The resulting standalone setup package will be generated at:
```text
installer\Output\LaptopLockAgentSetup.exe
```

---

## 4. Workstation Onboarding & Pairing Walkthrough

1. Open the **Laptop Remote Lock Controller** web or mobile app.
2. Sign in and click **"+ Add Laptop"** in the top navigation.
3. Enter the workstation name (e.g. `Office ThinkPad`, `Home Desktop`).
4. Click **"Register Laptop"**. The app provisions server-side credentials and displays the **One-Time Pairing Key**.
5. Click **"📋 Copy Pairing Key"**.
6. On the target Windows laptop, run `LaptopLockAgentSetup.exe`.
7. Paste the Pairing Key into the setup wizard and complete the installation.
8. The workstation is paired and immediately reports `AGENT ONLINE` on the dashboard!

