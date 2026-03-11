import { useState } from 'react';
import { User, Folder, Palette, Info, Save } from 'lucide-react';

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

  const handleSaveListener = async () => {
    if (window.electronAPI) {
      await window.electronAPI.updateListenerName({ userId: user.id, listenerName });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
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
