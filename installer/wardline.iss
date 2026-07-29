; Wardline Windows installer (Inno Setup 6).
;
; Build:  iscc installer\wardline.iss        (or: npm run build:release)
; Run  :  WardlineSetup.exe /DeviceToken=wl-xxxx [/ApiUrl=https://api.example.com]
;
; With no /DeviceToken the installer asks for the device key on a wizard page,
; so a parent can paste the value the dashboard gave them. That page has a
; "Test Connection" button — it calls GET /api/devices/whoami with the typed
; key before the parent commits to anything, so a wrong or stale key is
; caught immediately instead of surfacing days later as "offline" with no clue why.
;
; One elevated run does everything: installs the agent, registers it as an
; auto-starting service with restart-on-failure, and deploys the browser
; extension by managed policy (force-install + ApiUrl/DeviceToken config).

#define AppName        "Wardline"
#define AppPublisher   "Wardline"
#define AgentExe       "wardline-agent.exe"
; Read straight off the published exe (built by tools\build-release.ps1 step 1
; before this script runs) instead of a separate literal that drifts out of
; sync with the .csproj's <Version> — that mismatch already shipped once.
#define AppVersion     GetVersionNumbersString("..\dist\agent\" + AgentExe)
#define ServiceName    "WardlineAgent"
#define ServiceDisplay "Wardline Monitor Agent"
#define DefaultApiUrl  "https://api.wardline.app"

; Replace with the ID assigned when the extension is published to the stores.
; Until then the extension must be loaded manually (see README).
#define ExtensionId    "REPLACE_WITH_STORE_EXTENSION_ID"
#define ChromeUpdate   "https://clients2.google.com/service/update2/crx"
#define EdgeUpdate     "https://edge.microsoft.com/extensionwebstorebase/v1/crx"

[Setup]
AppId={{8E2C6A41-3F5D-4C7B-9A10-6D1F2B3C4D5E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=admin
OutputDir=..\dist
OutputBaseFilename=WardlineSetup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#AppName}
WizardStyle=modern
; SignTool=wardlinesign          ; enabled by build-release.ps1 when a cert is supplied

[Files]
; Built by tools\build-release.ps1 (dotnet publish -o dist\agent).
Source: "..\dist\agent\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Registry]
; --- Force-install the extension in Chrome and Edge -------------------------
Root: HKLM; Subkey: "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"; \
  ValueType: string; ValueName: "1"; ValueData: "{#ExtensionId};{#ChromeUpdate}"; \
  Flags: uninsdeletevalue; Check: HasExtensionId
Root: HKLM; Subkey: "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"; \
  ValueType: string; ValueName: "1"; ValueData: "{#ExtensionId};{#EdgeUpdate}"; \
  Flags: uninsdeletevalue; Check: HasExtensionId

; --- Configure the extension via managed policy -----------------------------
; The extension reads these through chrome.storage.managed, so the device token
; never has to be typed into the browser.
Root: HKLM; Subkey: "SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\{#ExtensionId}\policy"; \
  ValueType: string; ValueName: "ApiUrl"; ValueData: "{code:GetApiUrl}"; \
  Flags: uninsdeletekey; Check: HasExtensionId
Root: HKLM; Subkey: "SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\{#ExtensionId}\policy"; \
  ValueType: string; ValueName: "DeviceToken"; ValueData: "{code:GetDeviceToken}"; \
  Check: HasExtensionId
Root: HKLM; Subkey: "SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\{#ExtensionId}\policy"; \
  ValueType: string; ValueName: "ApiUrl"; ValueData: "{code:GetApiUrl}"; \
  Flags: uninsdeletekey; Check: HasExtensionId
Root: HKLM; Subkey: "SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\{#ExtensionId}\policy"; \
  ValueType: string; ValueName: "DeviceToken"; ValueData: "{code:GetDeviceToken}"; \
  Check: HasExtensionId

[Run]
Filename: "{sys}\sc.exe"; \
  Parameters: "create {#ServiceName} binPath= ""{app}\{#AgentExe}"" start= auto obj= LocalSystem DisplayName= ""{#ServiceDisplay}"""; \
  Flags: runhidden waituntilterminated; StatusMsg: "Registering the Wardline service..."
Filename: "{sys}\sc.exe"; \
  Parameters: "description {#ServiceName} ""Wardline parental-monitoring agent. Reports device telemetry and integrity status."""; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; \
  Parameters: "failure {#ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/5000"; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "start {#ServiceName}"; \
  Flags: runhidden waituntilterminated; StatusMsg: "Starting protection..."

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "StopWardlineSvc"
Filename: "{sys}\sc.exe"; Parameters: "delete {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "DeleteWardlineSvc"

[Code]
var
  TokenPage: TInputQueryWizardPage;
  TestButton: TNewButton;
  TestResultLabel: TNewStaticText;
  ConnectionVerified: Boolean;

function HasExtensionId: Boolean;
begin
  { Skip the browser-policy keys until a real store ID is configured. }
  Result := '{#ExtensionId}' <> 'REPLACE_WITH_STORE_EXTENSION_ID';
end;

function ParamValue(const Name, Default: String): String;
begin
  Result := ExpandConstant('{param:' + Name + '|' + Default + '}');
end;

function GetDeviceToken(Param: String): String;
begin
  Result := Trim(ParamValue('DeviceToken', ''));
  { Fall back to whatever was typed on the wizard page. }
  if (Result = '') and (TokenPage <> nil) then
    Result := Trim(TokenPage.Values[0]);
end;

function GetApiUrl(Param: String): String;
begin
  Result := Trim(ParamValue('ApiUrl', '{#DefaultApiUrl}'));
end;

{ Pull a top-level "key":"value" string out of a small, known-shape JSON
  response. Not a general parser — fine here because /api/devices/whoami's
  name fields are server-validated to [\w .-] and can never contain a quote. }
function ExtractJsonString(const Json, Key: String): String;
var
  P, P2: Integer;
  Pattern: String;
begin
  Result := '';
  Pattern := '"' + Key + '":"';
  P := Pos(Pattern, Json);
  if P = 0 then Exit;
  P := P + Length(Pattern);
  P2 := Pos('"', Copy(Json, P, MaxInt));
  if P2 = 0 then Exit;
  Result := Copy(Json, P, P2 - 1);
end;

{ Calls GET /api/devices/whoami with whatever key is currently in the box.
  This is the exact same request the real agent will make once installed, so
  a pass here means the parent's setup will actually work — not a guess. }
procedure TestButtonClick(Sender: TObject);
var
  Http: Variant;
  DeviceToken, ApiUrl: String;
begin
  DeviceToken := Trim(TokenPage.Values[0]);
  if DeviceToken = '' then
  begin
    TestResultLabel.Font.Color := clRed;
    TestResultLabel.Caption := 'Enter a device key first.';
    Exit;
  end;

  ApiUrl := GetApiUrl('');
  TestButton.Enabled := False;
  WizardForm.Cursor := crHourGlass;
  try
    try
      Http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
      Http.Open('GET', ApiUrl + '/api/devices/whoami', False);
      Http.SetRequestHeader('Authorization', 'Bearer ' + DeviceToken);
      Http.SetTimeouts(5000, 5000, 8000, 8000);
      Http.Send('');

      if Http.Status = 200 then
      begin
        ConnectionVerified := True;
        TestResultLabel.Font.Color := clGreen;
        TestResultLabel.Caption := '✓ Connected as "' + ExtractJsonString(Http.ResponseText, 'deviceName') + '"';
      end
      else if Http.Status = 401 then
      begin
        ConnectionVerified := False;
        TestResultLabel.Font.Color := clRed;
        TestResultLabel.Caption := 'That key wasn''t recognized. Check the Devices screen for the current one.';
      end
      else
      begin
        ConnectionVerified := False;
        TestResultLabel.Font.Color := clRed;
        TestResultLabel.Caption := 'Server error (status ' + IntToStr(Http.Status) + '). Try again in a moment.';
      end;
    except
      ConnectionVerified := False;
      TestResultLabel.Font.Color := clRed;
      TestResultLabel.Caption := 'Couldn''t reach ' + ApiUrl + '. Check the internet connection on this PC.';
    end;
  finally
    TestButton.Enabled := True;
    WizardForm.Cursor := crDefault;
  end;
end;

{ Typing invalidates whatever the last test said, so a stale ✓ can't linger
  next to a key that's since changed. }
procedure DeviceKeyChanged(Sender: TObject);
begin
  ConnectionVerified := False;
  TestResultLabel.Caption := '';
end;

procedure InitializeWizard;
begin
  { Only ask when the key wasn't supplied on the command line. }
  if Trim(ParamValue('DeviceToken', '')) = '' then
  begin
    TokenPage := CreateInputQueryPage(wpWelcome,
      'Device key',
      'Connect this PC to your Wardline account',
      'In Wardline, open Devices and choose "Add a device". Paste the device key it shows below, then ' +
        'test it before continuing.');
    TokenPage.Add('Device key:', False);
    TokenPage.Edits[0].OnChange := @DeviceKeyChanged;

    TestButton := TNewButton.Create(TokenPage);
    TestButton.Parent := TokenPage.Surface;
    TestButton.Caption := 'Test Connection';
    TestButton.Left := 0;
    TestButton.Top := TokenPage.Edits[0].Top + TokenPage.Edits[0].Height + 16;
    TestButton.Width := 120;
    TestButton.Height := 23;
    TestButton.OnClick := @TestButtonClick;

    TestResultLabel := TNewStaticText.Create(TokenPage);
    TestResultLabel.Parent := TokenPage.Surface;
    TestResultLabel.Left := TestButton.Left + TestButton.Width + 12;
    TestResultLabel.Top := TestButton.Top + 4;
    TestResultLabel.Width := TokenPage.SurfaceWidth - TestButton.Width - 12;
    TestResultLabel.AutoSize := False;
    TestResultLabel.WordWrap := True;
    TestResultLabel.Caption := '';
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (TokenPage <> nil) and (CurPageID = TokenPage.ID) then
  begin
    if Trim(TokenPage.Values[0]) = '' then
    begin
      MsgBox('Enter the device key from your Wardline dashboard to continue.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if not ConnectionVerified then
      Result := MsgBox('You haven''t successfully tested this key yet. Continue anyway?', mbConfirmation, MB_YESNO) = IDYES;
  end;
end;

{ Remove any previous service before laying down new files. }
procedure StopExistingService;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), 'stop {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\sc.exe'), 'delete {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
end;

{ Write the agent's configuration with the device key baked in. }
procedure WriteAgentConfig;
var
  Config: String;
begin
  Config :=
    '{' + #13#10 +
    '  "Logging": { "LogLevel": { "Default": "Information" } },' + #13#10 +
    '  "Wardline": {' + #13#10 +
    '    "ApiUrl": "' + GetApiUrl('') + '",' + #13#10 +
    '    "DeviceToken": "' + GetDeviceToken('') + '",' + #13#10 +
    '    "SampleSeconds": 60,' + #13#10 +
    '    "WatchdogSeconds": 30' + #13#10 +
    '  }' + #13#10 +
    '}' + #13#10;
  SaveStringToFile(ExpandConstant('{app}\appsettings.json'), Config, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopExistingService
  else if CurStep = ssPostInstall then
    WriteAgentConfig;
end;
