import { useRef, useState } from 'react';
import { History, LayoutDashboard, Settings, Square } from 'lucide-react';
import BentoGrid from './components/BentoGrid';
import LoginPage from './components/LoginPage';
import MeetingRecorder from './components/MeetingRecorder';
import PastMeetings from './components/PastMeetings';
import PostMeetingDashboard from './components/PostMeetingDashboard';
import SettingsPage from './components/SettingsPage';
import TitleBar from './components/TitleBar';
import type { CurrentMeetingInfo } from './types/meeting';

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
  const [isRecording, setIsRecording] = useState(false);
  const [showPostMeeting, setShowPostMeeting] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeetingInfo | null>(null);
  const [lastMeeting, setLastMeeting] = useState<CurrentMeetingInfo | null>(null);
  const stopFnRef = useRef<(() => Promise<void>) | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'past-meetings', label: 'Past Meetings', icon: <History size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  const handleRecordingStarted = (
    _stream: MediaStream,
    stopFn: () => Promise<void>,
    _title: string,
    meetingInfo: CurrentMeetingInfo,
  ) => {
    setCurrentMeeting(meetingInfo);
    setIsRecording(true);
    setShowPostMeeting(false);
    stopFnRef.current = stopFn;
    recordingStartTimeRef.current = meetingInfo.startTime;
  };

  const handleRecordingStopped = (meetingInfo: CurrentMeetingInfo) => {
    setIsRecording(false);
    setCurrentMeeting(null);
    setLastMeeting(meetingInfo);
    setShowPostMeeting(true);
    stopFnRef.current = null;
  };

  const handleStopClick = async () => {
    if (Date.now() - recordingStartTimeRef.current < 1000) {
      return;
    }

    if (stopFnRef.current) {
      await stopFnRef.current();
    }
  };

  const handleNewMeeting = () => {
    setShowPostMeeting(false);
    setLastMeeting(null);
  };

  if (!user) {
    return (
      <div className="app-root">
        <TitleBar />
        <LoginPage onLogin={setUser} />
      </div>
    );
  }

  const renderDashboard = () => {
    if (isRecording && currentMeeting) {
      return (
        <>
          <header className="page-header page-header-row">
            <div>
              <h2 className="page-label">Recording in progress</h2>
              <h3 className="page-title">Live Meeting</h3>
            </div>
            <button
              onClick={() => void handleStopClick()}
              className="recorder-btn recorder-btn-stop recorder-btn-compact"
            >
              <Square size={16} />
              Stop Recording
            </button>
          </header>
          <BentoGrid
            key={currentMeeting.meetingId}
            meetingId={currentMeeting.meetingId}
            listenerName={user.listener_name || user.username}
          />
        </>
      );
    }

    if (showPostMeeting && lastMeeting) {
      return (
        <PostMeetingDashboard
          key={lastMeeting.dbId}
          meetingTitle={lastMeeting.title}
          meetingDbId={lastMeeting.dbId}
          onNewMeeting={handleNewMeeting}
        />
      );
    }

    return (
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
    );
  };

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
            <button className="sidebar-logout" onClick={() => setUser(null)}>Sign out</button>
            <div className="sidebar-version">v0.1.0</div>
          </div>
        </div>

        <main className="main-content">
          <section
            className="tab-panel"
            style={{ display: activeTab === 'dashboard' ? 'flex' : 'none' }}
            aria-hidden={activeTab !== 'dashboard'}
          >
            {renderDashboard()}
          </section>
          <section
            className="tab-panel"
            style={{ display: activeTab === 'past-meetings' ? 'flex' : 'none' }}
            aria-hidden={activeTab !== 'past-meetings'}
          >
            <PastMeetings />
          </section>
          <section
            className="tab-panel"
            style={{ display: activeTab === 'settings' ? 'flex' : 'none' }}
            aria-hidden={activeTab !== 'settings'}
          >
            <SettingsPage user={user} />
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
