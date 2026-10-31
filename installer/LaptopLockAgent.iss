; =====================================================================
; Inno Setup Script: Laptop Remote Lock Agent
; Target OS: Windows 10 / Windows 11 (x64)
; Mode: Per-User Interactive Installation (No Admin Required)
; =====================================================================

#define MyAppName "Laptop Remote Lock Agent"
#define MyAppVersion "1.5.3"
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
; Stop only the installed agent process before replacing agent.js.
Source: "runner\stop-agent.ps1"; DestDir: "{app}\runner"; Flags: ignoreversion
; Agent logic script and system tray
Source: "..\agent.js"; DestDir: "{app}\app"; Flags: ignoreversion; BeforeInstall: StopExistingAgent
Source: "..\LaptopLockAgentTray.exe"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\tray.ps1"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\app_icon.ico"; DestDir: "{app}\app"; Flags: ignoreversion
; Runner scripts
Source: "runner\start-agent.bat"; DestDir: "{app}\runner"; Flags: ignoreversion
Source: "runner\start-agent-hidden.vbs"; DestDir: "{app}\runner"; Flags: ignoreversion
; Portable Node runtime (Embedded if bin\node.exe is present)
Source: "bin\node.exe"; DestDir: "{app}\bin"; Flags: ignoreversion skipifsourcedoesntexist
; Bundled offline FFmpeg screen recording engine
Source: "tools\ffmpeg\*"; DestDir: "{localappdata}\LaptopLockAgent\tools\ffmpeg"; Flags: ignoreversion recursesubdirs skipifsourcedoesntexist

[Icons]
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Registry]
; Single, reliable auto-start on user logon (works on AC and battery power)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LaptopLockAgent"; ValueData: """wscript.exe"" ""{app}\runner\start-agent-hidden.vbs"""; Flags: uninsdeletevalue

[Run]
; Launch agent immediately upon installation completion
Filename: "wscript.exe"; Parameters: """{app}\runner\start-agent-hidden.vbs"""; Description: "Start Remote Lock Agent now"; Flags: nowait postinstall skipifsilent

[Code]
var
  PairingPage: TInputQueryWizardPage;

procedure StopExistingAgent;
var
  ErrorCode: Integer;
  Params: String;
begin
  if not FileExists(ExpandConstant('{app}\runner\stop-agent.ps1')) or
     not FileExists(ExpandConstant('{app}\app\agent.js')) then
    Exit;

  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\runner\stop-agent.ps1') + '" -AgentScriptPath "' + ExpandConstant('{app}\app\agent.js') + '"';
  Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
end;

procedure InitializeWizard;
begin
  // Keep existing pairing credentials on upgrades; request a key only on first install.
  PairingPage := nil;
  if not FileExists(ExpandConstant('{localappdata}\LaptopLockAgent\config.json')) and
     not FileExists(ExpandConstant('{localappdata}\LaptopLockAgent\.agent-token')) then
  begin
    PairingPage := CreateInputQueryPage(wpSelectDir,
      'Laptop Pairing Key',
      'Enter pairing credentials from your controller dashboard',
      'To link this workstation, paste the Pairing Key generated in the mobile/web controller app:');
    PairingPage.Add('Pairing Key (Base64 JSON):', False);
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PairKeyRaw: String;
begin
  Result := True;
  if Assigned(PairingPage) and (CurPageID = PairingPage.ID) then
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
  ConfigDir, ConfigPath, PairKeyRaw: String;
  ErrorCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigDir := ExpandConstant('{localappdata}\LaptopLockAgent');
    ConfigPath := ConfigDir + '\config.json';
    ForceDirectories(ConfigDir);

    // End and delete legacy scheduled task if present from prior versions
    Exec('schtasks.exe', '/End /TN "LaptopLockAgent"', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
    Exec('schtasks.exe', '/Delete /TN "LaptopLockAgent" /F', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);

    // Remove legacy startup folder shortcut to avoid duplicate instance conflicts
    DeleteFile(ExpandConstant('{userstartup}\LaptopLockAgent.lnk'));

    PairKeyRaw := '';
    if Assigned(PairingPage) then PairKeyRaw := Trim(PairingPage.Values[0]);
    
    // Save configuration JSON into user local app data
    if Length(PairKeyRaw) > 0 then
    begin
      SaveStringToFile(ConfigPath, PairKeyRaw, False);
    end;

    // Let the installed launcher start the updated agent again.
    DeleteFile(ExpandConstant('{localappdata}\LaptopLockAgent\agent.stop'));
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ErrorCode: Integer;
  ConfigDir, Params: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Safely stop running agent
    if FileExists(ExpandConstant('{app}\runner\stop-agent.ps1')) and
       FileExists(ExpandConstant('{app}\app\agent.js')) then
    begin
      Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\runner\stop-agent.ps1') + '" -AgentScriptPath "' + ExpandConstant('{app}\app\agent.js') + '"';
      Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
    end;

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
