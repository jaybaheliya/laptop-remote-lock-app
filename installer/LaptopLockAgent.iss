; =====================================================================
; Inno Setup Script: Laptop Remote Lock Agent
; Target OS: Windows 10 / Windows 11 (x64)
; Mode: Per-User Interactive Installation (No Admin Required)
; =====================================================================

#define MyAppName "Laptop Remote Lock Agent"
#define MyAppVersion "1.5.0"
#define MyAppPublisher "Security Defense Console"
#define MyAppExeName "start-agent-hidden.vbs"

[Setup]
AppId={{D37E5528-912A-44C1-8BC2-409D3E64AE71}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\LaptopLockAgent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=LaptopLockAgentSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#MyAppName}
SetupIconFile=..\app_icon.ico

[Files]
; Agent logic script and system tray
Source: "..\agent.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\LaptopLockAgentTray.exe"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\tray.ps1"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\app_icon.ico"; DestDir: "{app}\app"; Flags: ignoreversion
; Runner scripts
Source: "runner\start-agent.bat"; DestDir: "{app}\runner"; Flags: ignoreversion
Source: "runner\start-agent-hidden.vbs"; DestDir: "{app}\runner"; Flags: ignoreversion
; Portable Node runtime (Embedded if bin\node.exe is present)
Source: "bin\node.exe"; DestDir: "{app}\bin"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userstartup}\LaptopLockAgent"; Filename: "wscript.exe"; Parameters: """{app}\runner\start-agent-hidden.vbs"""; WorkingDir: "{app}\runner"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LaptopLockAgent"; ValueData: """wscript.exe"" ""{app}\runner\start-agent-hidden.vbs"""; Flags: uninsdeletevalue

[Run]
; Launch agent immediately upon installation completion
Filename: "wscript.exe"; Parameters: """{app}\runner\start-agent-hidden.vbs"""; Description: "Start Remote Lock Agent now"; Flags: nowait postinstall skipifsilent

[Code]
var
  PairingPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  // Create Pairing Key configuration page
  PairingPage := CreateInputQueryPage(wpSelectDir,
    'Laptop Pairing Key',
    'Enter pairing credentials from your controller dashboard',
    'To link this workstation, paste the Pairing Key generated in the mobile/web controller app:');
  PairingPage.Add('Pairing Key (Base64 JSON):', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PairKeyRaw: String;
begin
  Result := True;
  if CurPageID = PairingPage.ID then
  begin
    PairKeyRaw := Trim(PairingPage.Values[0]);
    if Length(PairKeyRaw) = 0 then
    begin
      MsgBox('Please paste your Pairing Key before continuing.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigDir, ConfigPath, TaskCmd, PairKeyRaw: String;
  ErrorCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigDir := ExpandConstant('{localappdata}\LaptopLockAgent');
    ConfigPath := ConfigDir + '\config.json';
    ForceDirectories(ConfigDir);

    // Terminate any running agent instance so it releases PID lock and reloads new config
    Exec('taskkill.exe', '/F /IM node.exe /FI "WINDOWTITLE eq LaptopLockAgent*"', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
    Exec('schtasks.exe', '/End /TN "LaptopLockAgent"', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);

    PairKeyRaw := Trim(PairingPage.Values[0]);
    
    // Save configuration JSON into user local app data
    if Length(PairKeyRaw) > 0 then
    begin
      SaveStringToFile(ConfigPath, PairKeyRaw, False);
    end;

    // Secure config folder: restrict ACLs exclusively to current user
    Exec('icacls.exe', '"' + ConfigDir + '" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);

    // Register Windows Task Scheduler task (runs silently on user sign-in)
    TaskCmd := '/Create /TN "LaptopLockAgent" /TR "wscript.exe \""' + ExpandConstant('{app}\runner\start-agent-hidden.vbs') + '\""" /SC ONLOGON /RL LIMITED /F';
    Exec('schtasks.exe', TaskCmd, '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ErrorCode: Integer;
  ConfigDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Terminate existing agent task & scheduled task
    Exec('schtasks.exe', '/End /TN "LaptopLockAgent"', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
    Exec('schtasks.exe', '/Delete /TN "LaptopLockAgent" /F', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);

    // Prompt user to purge credentials
    if MsgBox('Do you want to remove your stored workstation credentials and logs?', mbConfirmation, MB_YESNO) = IDYES then
    begin
      ConfigDir := ExpandConstant('{localappdata}\LaptopLockAgent');
      DelTree(ConfigDir, True, True, True);
    end;
  end;
end;

