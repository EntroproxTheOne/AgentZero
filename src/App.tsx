import { useEffect, useRef, useState } from 'react';
import { Building2, History, LayoutDashboard, MessagesSquare, Settings, Square, Upload } from 'lucide-react';
import BentoGrid from './components/BentoGrid';
import LoginPage from './components/LoginPage';
import MeetingRecorder from './components/MeetingRecorder';
import PastMeetings from './components/PastMeetings';
import PostMeetingDashboard from './components/PostMeetingDashboard';
import SettingsPage from './components/SettingsPage';
import TitleBar from './components/TitleBar';
import FirstRunSetup from './components/FirstRunSetup';
import Walkthrough from './components/Walkthrough';
import ClientsPage from './components/ClientsPage';
import AskPage from './components/AskPage';
import UploadRecordingDialog from './components/UploadRecordingDialog';
import MacPermissions from './components/MacPermissions';
import CaptureBar from './components/CaptureBar';
import type { CaptureControls, CaptureState } from './components/capture';
import type { AppUser, CurrentMeetingInfo } from './types/meeting';

type Tab = 'dashboard' | 'past-meetings' | 'clients' | 'ask' | 'settings';

function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isRecording, setIsRecording] = useState(false);
  const [showPostMeeting, setShowPostMeeting] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeetingInfo | null>(null);
  const [lastMeeting, setLastMeeting] = useState<CurrentMeetingInfo | null>(null);
  const [discardNotice, setDiscardNotice] = useState<string | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState>({ microphone: false, computerSound: false, screenVideo: false, problem: null });
  const [captureControls, setCaptureControls] = useState<CaptureControls | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const [sttStatus, setSttStatus] = useState<{ state: 'live' | 'reconnecting' | 'lost'; detail: string | null } | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.onTranscriptionStatus) return undefined;
    return window.electronAPI.onTranscriptionStatus(({ state, detail }) => setSttStatus({ state, detail }));
  }, []);
  const [reviewMeeting, setReviewMeeting] = useState<{ dbId: number; title: string } | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [meetingsRefreshKey, setMeetingsRefreshKey] = useState(0);
  const stopFnRef = useRef<(() => Promise<void>) | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'past-meetings', label: 'Meetings', icon: <History size={18} /> },
    { id: 'clients', label: 'Clients', icon: <Building2 size={18} /> },
    { id: 'ask', label: 'Ask', icon: <MessagesSquare size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  const handleRecordingStarted = (
    _stream: MediaStream,
    stopFn: () => Promise<void>,
    _title: string,
    meetingInfo: CurrentMeetingInfo,
    controls: CaptureControls,
  ) => {
    setCaptureControls(controls);
    setStopError(null);
    setSttStatus(null);
    setCurrentMeeting(meetingInfo);
    setIsRecording(true);
    setShowPostMeeting(false);
    setDiscardNotice(null);
    stopFnRef.current = stopFn;
    recordingStartTimeRef.current = meetingInfo.startTime;
  };

  const handleRecordingDiscarded = (reason: string) => {
    setIsRecording(false);
    setCurrentMeeting(null);
    setShowPostMeeting(false);
    stopFnRef.current = null;
    setDiscardNotice(reason);
  };

  const handleRecordingStopped = (meetingInfo: CurrentMeetingInfo) => {
    setIsRecording(false);
    setCurrentMeeting(null);
    setLastMeeting(meetingInfo);
    setShowPostMeeting(true);
    setMeetingsRefreshKey((value) => value + 1);
    stopFnRef.current = null;
  };

  const goToTab = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'past-meetings') setMeetingsRefreshKey((value) => value + 1);
  };

  const handleUploaded = (dbId: number, title: string) => {
    setShowUpload(false);
    setMeetingsRefreshKey((value) => value + 1);
    setReviewMeeting({ dbId, title });
    setActiveTab('dashboard');
  };

  const handleStopClick = async () => {
    if (Date.now() - recordingStartTimeRef.current < 1000) {
      return;
    }

    if (stopFnRef.current) {
      setStopError(null);
      try {
        await stopFnRef.current();
      } catch (error) {
        const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);
        setStopError(`Could not stop cleanly: ${message}. Press Stop Recording again to retry.`);
      }
    }
  };

  const handleNewMeeting = () => {
    if (reviewMeeting) {
      setReviewMeeting(null);
      goToTab('past-meetings');
      return;
    }
    setShowPostMeeting(false);
    setLastMeeting(null);
  };

  const handleOpenPastMeeting = (dbId: number, title: string) => {
    setReviewMeeting({ dbId, title });
    setActiveTab('dashboard');
  };

  useEffect(() => {
    void window.electronAPI?.needsFirstRunSetup().then(setNeedsSetup).catch(() => setNeedsSetup(false));
  }, []);

  const handleSignedIn = (signedIn: AppUser) => {
    setNeedsSetup(false);
    setUser(signedIn);
    void window.electronAPI.getAppSettings()
      .then((settings) => setShowWalkthrough(!settings.onboardingDone))
      .catch(() => {});
  };

  const handleSignOut = async () => {
    // Never leave a recording running behind the sign-in screen.
    if (isRecording && stopFnRef.current) {
      await stopFnRef.current();
    }
    try {
      await window.electronAPI?.logout();
    } catch (error) {
      window.alert(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error));
      return;
    }
    setUser(null);
    setCurrentMeeting(null);
    setIsRecording(false);
    setShowPostMeeting(false);
    setReviewMeeting(null);
    setShowWalkthrough(false);
    setActiveTab('dashboard');
  };

  const finishWalkthrough = () => {
    setShowWalkthrough(false);
    void window.electronAPI?.updateAppSettings({ onboardingDone: true });
  };

  if (!user) {
    return (
      <div className="app-root">
        <TitleBar />
        {needsSetup === null ? null : needsSetup
          ? <FirstRunSetup onComplete={handleSignedIn} />
          : <LoginPage onLogin={handleSignedIn} />}
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
          <CaptureBar state={captureState} controls={captureControls} transcriptStatus={sttStatus} />
          {stopError && (
            <div className="detected-banner detected-banner-warn" role="alert">
              <span>{stopError}</span>
            </div>
          )}
          <BentoGrid
            key={currentMeeting.meetingId}
            meetingId={currentMeeting.meetingId}
            listenerName={user.listener_name || user.username}
          />
        </>
      );
    }

    if (reviewMeeting) {
      return (
        <PostMeetingDashboard
          key={`review-${reviewMeeting.dbId}`}
          meetingTitle={reviewMeeting.title}
          meetingDbId={reviewMeeting.dbId}
          onNewMeeting={handleNewMeeting}
          isReview
        />
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
        {discardNotice && (
          <div className="detected-banner detected-banner-warn discard-notice" role="status">
            <span>{discardNotice}</span>
            <button type="button" className="modal-close" onClick={() => setDiscardNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}
        <MeetingRecorder
          onRecordingStarted={handleRecordingStarted}
          onRecordingStopped={handleRecordingStopped}
          onRecordingDiscarded={handleRecordingDiscarded}
          onCaptureChange={setCaptureState}
        />
        <button className="dashboard-upload" onClick={() => setShowUpload(true)}>
          <Upload size={18} />
          <span>
            <strong>Already recorded a call?</strong>
            <em>Upload audio or video and get the transcript, highlights and minutes.</em>
          </span>
        </button>
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
                onClick={() => goToTab(item.id)}
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
            <button className="sidebar-logout" onClick={() => void handleSignOut()}>Sign out</button>
            <div className="sidebar-version">v0.1.0</div>
          </div>
        </div>

        <main className="main-content">
          <MacPermissions variant="banner" />
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
            <PastMeetings
              onOpenMeeting={handleOpenPastMeeting}
              onUpload={() => setShowUpload(true)}
              refreshKey={meetingsRefreshKey}
            />
          </section>
          <section
            className="tab-panel"
            style={{ display: activeTab === 'clients' ? 'flex' : 'none' }}
            aria-hidden={activeTab !== 'clients'}
          >
            {activeTab === 'clients' && <ClientsPage />}
          </section>
          <section
            className="tab-panel"
            style={{ display: activeTab === 'ask' ? 'flex' : 'none' }}
            aria-hidden={activeTab !== 'ask'}
          >
            <AskPage onOpenMeeting={handleOpenPastMeeting} />
          </section>
          <section
            className="tab-panel"
            style={{ display: activeTab === 'settings' ? 'flex' : 'none' }}
            aria-hidden={activeTab !== 'settings'}
          >
            <SettingsPage
              key={user.id}
              user={user}
              onUserUpdated={setUser}
              onSignedOut={handleSignOut}
              onShowWalkthrough={() => setShowWalkthrough(true)}
            />
          </section>
        </main>
      </div>
      {showWalkthrough && <Walkthrough user={user} onDone={finishWalkthrough} />}
      {showUpload && <UploadRecordingDialog onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />}
    </div>
  );
}

export default App;
