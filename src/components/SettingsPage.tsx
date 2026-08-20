import { useEffect, useState } from 'react';
import { User, Folder, Palette, Info, Save, Languages, Monitor } from 'lucide-react';
import type { AppSettings } from '../types/meeting';

interface SettingsPageProps {
  user: {
    id: number;
    username: string;
    email: string;
    listener_name: string;
  };
}

export default function SettingsPage({ user }: SettingsPageProps) {
  const [listenerName, setListenerName] = useState(user.listener_name || user.username);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    void window.electronAPI.getAppSettings().then(setSettings).catch((error) => {
      console.error('Failed to load app settings:', error);
    });
  }, []);

  const handleSaveListener = async () => {
    if (window.electronAPI) {
      await window.electronAPI.updateListenerName({ userId: user.id, listenerName });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleIndiaModeToggle = async (enabled: boolean) => {
    if (!window.electronAPI) return;
    const updatedSettings = await window.electronAPI.updateAppSettings({ nativeIndiaMode: enabled });
    setSettings(updatedSettings);
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
        {/* Profile Section */}
        <div className="settings-card">
          <div className="settings-card-header">
            <User size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Profile</h4>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">Username</label>
              <input type="text" className="setting-input" value={user.username} readOnly />
            </div>
            <div className="setting-row">
              <label className="setting-label">Email</label>
              <input type="text" className="setting-input" value={user.email} readOnly />
            </div>
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
              <select className="setting-input">
                <option>Light</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <Monitor size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Screen Recording</h4>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">Record the screen</label>
              <label className="settings-toggle-row">
                <div>
                  <div className="settings-toggle-title">
                    Screen video
                    <span className="settings-provider-meta">Off by default</span>
                  </div>
                  <div className="settings-toggle-sub">
                    When off, AgentZero captures microphone audio and transcription only. This applies to the next meeting.
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
              <div className="settings-provider-status">
                <span className="settings-provider-pill">
                  {settings?.screenRecordingEnabled ? 'Screen video enabled' : 'Microphone only'}
                </span>
                {settingsSaved && <span className="settings-provider-saved">Saved</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <Languages size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Native India Mode</h4>
            <span className="settings-beta-badge">Beta</span>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">India-first speech provider</label>
              <label className="settings-toggle-row">
                <div>
                  <div className="settings-toggle-title">
                    Sarvam Saaras v3
                    <span className="settings-provider-meta">Auto language detect</span>
                  </div>
                  <div className="settings-toggle-sub">
                    When enabled, new meetings use Sarvam Saaras v3 for multilingual Indian-language transcription while keeping the rest of the workflow unchanged.
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${settings?.nativeIndiaMode ? 'settings-toggle-on' : ''}`}
                  onClick={() => void handleIndiaModeToggle(!settings?.nativeIndiaMode)}
                  aria-pressed={settings?.nativeIndiaMode ?? false}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </label>
              <div className="settings-provider-status">
                <span className="settings-provider-pill">
                  Default mode: {settings?.transcriptionProvider === 'sarvam' ? 'Sarvam' : 'Deepgram'}
                </span>
                {settingsSaved && (
                  <span className="settings-provider-saved">Saved</span>
                )}
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
          </div>
        </div>
      </div>
    </div>
  );
}
