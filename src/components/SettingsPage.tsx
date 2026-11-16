import { useEffect, useState } from 'react';
import { User, Folder, Palette, Info, Save, Languages, Monitor, KeyRound, ShieldCheck } from 'lucide-react';
import type { AiConnectionTestResult, AppSettings, AppUser, CredentialsStatus } from '../types/meeting';
import AccountsSettings from './AccountsSettings';
import MacPermissions from './MacPermissions';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../theme';

interface SettingsPageProps {
  user: AppUser;
  onUserUpdated: (user: AppUser) => void;
  onSignedOut: () => void;
  onShowWalkthrough: () => void;
}

export default function SettingsPage({ user, onUserUpdated, onSignedOut, onShowWalkthrough }: SettingsPageProps) {
  const [listenerName, setListenerName] = useState(user.listener_name || user.username);
  const [saved, setSaved] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>(getThemeChoice);
  const setTheme = (choice: ThemeChoice) => {
    setThemeChoice(choice);
    setThemeState(choice);
  };
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [creds, setCreds] = useState<CredentialsStatus | null>(null);
  const [projectIdInput, setProjectIdInput] = useState('');
  const [serviceAccountInput, setServiceAccountInput] = useState('');
  const [sarvamKeyInput, setSarvamKeyInput] = useState('');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [showServiceAccount, setShowServiceAccount] = useState(false);
  const [credsMessage, setCredsMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    void window.electronAPI.getAppSettings().then(setSettings).catch((error) => {
      console.error('Failed to load app settings:', error);
    });
    void window.electronAPI.getCredentialsStatus().then((status) => {
      setCreds(status);
      setProjectIdInput(status.gcpProjectId ?? '');
    }).catch((error) => {
      console.error('Failed to load credentials status:', error);
    });
  }, []);

  const handleServiceAccountFile = async (file: File | undefined) => {
    if (!file) return;
    setServiceAccountInput(await file.text());
  };

  const handleSaveCredentials = async () => {
    if (!window.electronAPI) return;
    const patch: { gcpProjectId?: string; serviceAccountJson?: string; sarvamApiKey?: string; geminiApiKey?: string } = {};
    if (geminiKeyInput.trim()) patch.geminiApiKey = geminiKeyInput;
    if (projectIdInput.trim() !== (creds?.gcpProjectId ?? '')) patch.gcpProjectId = projectIdInput;
    if (serviceAccountInput.trim()) patch.serviceAccountJson = serviceAccountInput;
    if (sarvamKeyInput.trim()) patch.sarvamApiKey = sarvamKeyInput;
    try {
      const status = await window.electronAPI.updateCredentials(patch);
      setCreds(status);
      setProjectIdInput(status.gcpProjectId ?? '');
      setServiceAccountInput('');
      setSarvamKeyInput('');
      setGeminiKeyInput('');
      setTestResult(null);
      setCredsMessage({ kind: 'ok', text: 'Saved securely on this device.' });
    } catch (error) {
      const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);
      setCredsMessage({ kind: 'error', text });
    }
  };

  const handleTestConnection = async () => {
    if (!window.electronAPI) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.electronAPI.testAiConnection());
    } finally {
      setTesting(false);
    }
  };

  const handleSaveListener = async () => {
    if (window.electronAPI) {
      await window.electronAPI.updateListenerName({ userId: user.id, listenerName });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleToggle = async (patch: { showCost?: boolean; webSearchEnabled?: boolean; liveInsightsEnabled?: boolean; diarizationEnabled?: boolean }) => {
    if (!window.electronAPI) return;
    setSettings(await window.electronAPI.updateAppSettings(patch));
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  const handleScreenRecordingToggle = async (enabled: boolean) => {
    if (!window.electronAPI) return;
    const updatedSettings = await window.electronAPI.updateAppSettings({ screenRecordingEnabled: enabled });
    setSettings(updatedSettings);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h2 className="page-label">Configuration</h2>
        <h3 className="page-title">Settings</h3>
      </header>

      <div className="settings-grid">
        <MacPermissions variant="card" />
        <AccountsSettings user={user} onUserUpdated={onUserUpdated} onSignedOut={onSignedOut} />

        <div className="settings-card">
          <div className="settings-card-header">
            <User size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">In Meetings</h4>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">Listener Name</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="setting-input"
                  style={{ flex: 1 }}
                  value={listenerName}
                  onChange={(e) => setListenerName(e.target.value)}
                  placeholder="Name to detect in meetings"
                />
                <button className="setting-save-btn" onClick={handleSaveListener}>
                  {saved ? '✓ Saved' : <><Save size={14} /> Save</>}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Storage Section */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Folder size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Storage</h4>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">Recordings Directory</label>
              <input
                type="text"
                className="setting-input"
                value="Documents/AgentZero/Recordings"
                readOnly
              />
            </div>
          </div>
        </div>

        {/* Appearance Section */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Palette size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Appearance</h4>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">Theme</label>
              <select
                className="setting-input"
                value={theme}
                onChange={(e) => setTheme(e.target.value as ThemeChoice)}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <Monitor size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Recording</h4>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="settings-toggle-row">
                <div>
                  <div className="settings-toggle-title">Screen video by default</div>
                  <div className="settings-toggle-sub">
                    Pre-selects “Screen video” when you start a meeting. You can still change it each time. Computer sound is switched on automatically when a meeting app is open.
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${settings?.screenRecordingEnabled ? 'settings-toggle-on' : ''}`}
                  onClick={() => void handleScreenRecordingToggle(!settings?.screenRecordingEnabled)}
                  aria-pressed={settings?.screenRecordingEnabled ?? false}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </label>
              {settingsSaved && <span className="settings-provider-saved">Saved</span>}
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <ShieldCheck size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Privacy &amp; Cost</h4>
          </div>
          <div className="settings-card-body">
            <label className="settings-toggle-row">
              <div>
                <div className="settings-toggle-title">Live insights</div>
                <div className="settings-toggle-sub">Questions, jargon and suggestions during the meeting, refreshed every 30 seconds. When off, meetings are still recorded and transcribed live, and highlights and minutes are still written afterwards.</div>
              </div>
              <button
                type="button"
                className={`settings-toggle ${settings?.liveInsightsEnabled ? 'settings-toggle-on' : ''}`}
                onClick={() => void handleToggle({ liveInsightsEnabled: !settings?.liveInsightsEnabled })}
                aria-pressed={settings?.liveInsightsEnabled ?? true}
                aria-label="Live insights"
              >
                <span className="settings-toggle-knob" />
              </button>
            </label>
            <label className="settings-toggle-row">
              <div>
                <div className="settings-toggle-title">
                  Identify speakers
                  <span className="settings-provider-meta settings-provider-meta-plain">+₹0.10/min</span>
                </div>
                <div className="settings-toggle-sub">After each meeting, the recorded audio is sent once more to Sarvam to label who said what (Speaker 1, Speaker 2…), then the minutes are updated. Also the default for uploaded recordings.</div>
              </div>
              <button
                type="button"
                className={`settings-toggle ${settings?.diarizationEnabled ? 'settings-toggle-on' : ''}`}
                onClick={() => void handleToggle({ diarizationEnabled: !settings?.diarizationEnabled })}
                aria-pressed={settings?.diarizationEnabled ?? false}
                aria-label="Identify speakers"
              >
                <span className="settings-toggle-knob" />
              </button>
            </label>
            <label className="settings-toggle-row">
              <div>
                <div className="settings-toggle-title">Show meeting cost</div>
                <div className="settings-toggle-sub">After a meeting, show an estimate of what transcription and AI cost for it.</div>
              </div>
              <button
                type="button"
                className={`settings-toggle ${settings?.showCost ? 'settings-toggle-on' : ''}`}
                onClick={() => void handleToggle({ showCost: !settings?.showCost })}
                aria-pressed={settings?.showCost ?? false}
                aria-label="Show meeting cost"
              >
                <span className="settings-toggle-knob" />
              </button>
            </label>
            {settingsSaved && <span className="settings-provider-saved">Saved</span>}
          </div>
        </div>

        {user.isAdmin && (
        <div className="settings-card">
          <div className="settings-card-header">
            <KeyRound size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">AI &amp; Transcription</h4>
          </div>
          <div className="settings-card-body">
            <div className="settings-provider-status">
              <span className="settings-provider-pill">AI region: Mumbai ({creds?.location ?? 'asia-south1'})</span>
              <span className="settings-provider-pill">Gemini 3.5 Flash-Lite · 3.5 Flash</span>
            </div>
            {creds?.builtInKeys && (
              <p className="settings-toggle-sub">This copy comes with keys already set up. Anything you save here replaces them on this device.</p>
            )}
            {creds && !creds.secureStorageAvailable && (
              <p className="settings-toggle-sub">Secure storage is unavailable on this machine, so credentials cannot be saved.</p>
            )}

            <div className="setting-row">
              <label className="setting-label">Google Cloud project ID</label>
              <input
                type="text"
                className="setting-input"
                value={projectIdInput}
                onChange={(e) => setProjectIdInput(e.target.value)}
                placeholder="my-project-id"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="setting-row">
              <label className="setting-label">Vertex AI API key (Gemini)</label>
              <input
                type="password"
                className="setting-input"
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                placeholder={creds?.geminiKeySet ? `${creds.geminiKeySource === 'built-in' ? 'Built in' : 'Saved'} (${creds.geminiKeyHint})${creds.geminiKeySource === 'environment' ? ' from environment' : ''}. Leave empty to keep it` : 'Not set'}
                autoComplete="off"
              />
              <div className="settings-toggle-sub">
                Requests always go to the Mumbai endpoint of the project above.{' '}
                <button type="button" className="link-button" onClick={() => setShowServiceAccount((v) => !v)}>
                  {showServiceAccount || creds?.serviceAccountEmail ? 'Hide service account option' : 'Use a service account instead'}
                </button>
              </div>
            </div>

            {(showServiceAccount || creds?.serviceAccountEmail) && (
            <div className="setting-row">
              <label className="setting-label">Service account key (optional, replaces the API key)</label>
              <div className="settings-toggle-sub">
                {creds?.serviceAccountEmail
                  ? <>In use: {creds.serviceAccountEmail}{creds.serviceAccountSource === 'environment' ? ' (from environment)' : ''}</>
                  : 'Not set. Choose the JSON key file downloaded from Google Cloud, or paste its contents.'}
              </div>
              <input
                type="file"
                accept="application/json,.json"
                className="setting-input"
                onChange={(e) => void handleServiceAccountFile(e.target.files?.[0])}
              />
              <textarea
                className="setting-input"
                rows={3}
                value={serviceAccountInput}
                onChange={(e) => setServiceAccountInput(e.target.value)}
                placeholder={creds?.serviceAccountEmail ? 'Leave empty to keep the current key' : '{ "type": "service_account", … }'}
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
            )}

            <div className="setting-row">
              <label className="setting-label">Sarvam API key (transcription)</label>
              <input
                type="password"
                className="setting-input"
                value={sarvamKeyInput}
                onChange={(e) => setSarvamKeyInput(e.target.value)}
                placeholder={creds?.sarvamKeySet ? `${creds.sarvamKeySource === 'built-in' ? 'Built in' : 'Saved'} (${creds.sarvamKeyHint}). Leave empty to keep it` : 'Not set'}
                autoComplete="off"
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="setting-save-btn" onClick={() => void handleSaveCredentials()}>
                <Save size={14} /> Save credentials
              </button>
              <button className="setting-save-btn" onClick={() => void handleTestConnection()} disabled={testing}>
                {testing ? 'Testing…' : 'Test AI connection'}
              </button>
              {credsMessage && (
                <span className={credsMessage.kind === 'ok' ? 'settings-provider-saved' : 'settings-toggle-sub'} style={credsMessage.kind === 'error' ? { color: '#c0392b' } : undefined}>
                  {credsMessage.text}
                </span>
              )}
            </div>

            {testResult && (
              <div className="settings-toggle-sub">
                {testResult.ok
                  ? testResult.results.map((r) => (
                    <div key={r.model} style={r.ok ? undefined : { color: '#c0392b' }}>
                      {r.ok ? '✓' : '✗'} {r.model} ({testResult.location}){r.ok ? ` · ${r.latencyMs} ms` : ` · ${r.error}`}
                    </div>
                  ))
                  : <div style={{ color: '#c0392b' }}>✗ {testResult.error}</div>}
              </div>
            )}
          </div>
        </div>

        )}

        <div className="settings-card">
          <div className="settings-card-header">
            <Languages size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Transcription</h4>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">Speech provider</label>
              <div className="settings-toggle-title">
                Sarvam Saaras v4
                <span className="settings-provider-meta">Auto language detect</span>
              </div>
            </div>

            <div className="setting-row">
              <label className="setting-label">Supported Languages</label>
              <div className="settings-language-grid">
                {(settings?.sarvam.supportedLanguages ?? []).map((language) => (
                  <span key={language.code} className="settings-language-chip" title={language.code}>
                    {language.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* About Section */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Info size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">About</h4>
          </div>
          <div className="settings-card-body">
            <p className="settings-about-text">AgentZero v0.1.0</p>
            <p className="settings-about-sub">AI-powered meeting assistant</p>
            <button className="setting-save-btn" onClick={onShowWalkthrough}>Show the walkthrough again</button>
          </div>
        </div>
      </div>
    </div>
  );
}
