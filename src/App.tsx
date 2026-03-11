import { useState, useRef } from 'react';
import { Settings, History, LayoutDashboard, Square } from 'lucide-react';
import TitleBar from './components/TitleBar';
import MeetingRecorder from './components/MeetingRecorder';
import PastMeetings from './components/PastMeetings';
import SettingsPage from './components/SettingsPage';
import LoginPage from './components/LoginPage';
import AnalysisMode from './components/AnalysisMode';

type Tab = 'dashboard' | 'past-meetings' | 'settings';

interface UserData {
  id: number;
  username: string;
  email: string;
  listener_name: string;
}

function App() {
  const [user, setUser] = useState<UserData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const stopFnRef = useRef<(() => Promise<void>) | null>(null);

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'past-meetings', label: 'Past Meetings', icon: <History size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  const handleLogin = (userData: UserData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  const handleRecordingStarted = (stream: MediaStream, stopFn: () => Promise<void>) => {
    setRecordingStream(stream);
    setIsRecording(true);
    stopFnRef.current = stopFn;
  };

  const handleRecordingStopped = () => {
    setRecordingStream(null);
    setIsRecording(false);
    stopFnRef.current = null;
  };

  const handleStopClick = async () => {
    if (stopFnRef.current) {
      await stopFnRef.current();
    }
  };

  if (!user) {
    return (
      <div className="app-root">
        <TitleBar />
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <TitleBar />

      <div className="app-body">
        <div className="sidebar">
          <div className="sidebar-brand">
            <span className="sidebar-logo">Agent<span className="sidebar-logo-accent">Zero</span></span>
            <div className="sidebar-user">
              <span className="sidebar-user-name">{user.username}</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`sidebar-btn ${activeTab === item.id ? 'sidebar-btn-active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                {item.icon}
                {item.label}
                {item.id === 'dashboard' && isRecording && (
                  <span className="sidebar-live-indicator" />
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button className="sidebar-logout" onClick={handleLogout}>Sign out</button>
            <div className="sidebar-version">v0.1.0</div>
          </div>
        </div>

        <main className="main-content">
          {activeTab === 'dashboard' && (
            <>
              {isRecording ? (
                <>
                  <header className="page-header">
                    <h2 className="page-label">Recording in progress</h2>
                    <h3 className="page-title">Analysis Mode</h3>
                  </header>
                  <AnalysisMode
                    stream={recordingStream}
                    listenerName={user.listener_name || user.username}
                  />
                  <div className="analysis-stop-bar">
                    <button
                      onClick={handleStopClick}
                      className="recorder-btn recorder-btn-stop recorder-btn-compact"
                    >
                      <Square size={16} />
                      Stop Recording
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <header className="page-header">
                    <h2 className="page-label">Current Meeting</h2>
                    <h3 className="page-title">Ready to record</h3>
                  </header>
                  <MeetingRecorder
                    onRecordingStarted={handleRecordingStarted}
                    onRecordingStopped={handleRecordingStopped}
                  />
                </>
              )}
            </>
          )}
          {activeTab === 'past-meetings' && <PastMeetings />}
          {activeTab === 'settings' && <SettingsPage user={user} />}
        </main>
      </div>
    </div>
  );
}

export default App;
