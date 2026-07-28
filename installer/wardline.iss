; Wardline Windows installer (Inno Setup 6).
;
; Build:  iscc installer\wardline.iss        (or: npm run build:release)
; Run  :  WardlineSetup.exe /DeviceToken=wl-xxxx [/ApiUrl=https://api.example.com]
;
; With no /DeviceToken the installer asks for the device key on a wizard page,
; so a parent can paste the value the dashboard gave them.
;
; One elevated run does everything: installs the agent, registers it as an
; auto-starting service with restart-on-failure, and deploys the browser
; extension by managed policy (force-install + ApiUrl/DeviceToken config).

#define AppName        "Wardline"
#define AppPublisher   "Wardline"
#define AppVersion     "1.0.1"
#define AgentExe       "wardline-agent.exe"
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

procedure InitializeWizard;
begin
  { Only ask when the key wasn't supplied on the command line. }
  if Trim(ParamValue('DeviceToken', '')) = '' then
  begin
    TokenPage := CreateInputQueryPage(wpWelcome,
      'Device key',
      'Connect this PC to your Wardline account',
      'In Wardline, open Devices and choose "Add a device". Paste the device key it shows below.');
    TokenPage.Add('Device key:', False);
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
    end;
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
