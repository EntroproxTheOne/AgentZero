import { useEffect, useMemo, useState } from 'react';
import { Mic, Users, MonitorPlay, Sparkles, FileText, KeyRound, ShieldCheck, ArrowRight, ArrowLeft } from 'lucide-react';
import type { AppUser, RuntimeInfo } from '../types/meeting';

interface WalkthroughProps {
  user: AppUser;
  onDone: () => void;
}

interface Step {
  key: string;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}

function PermissionStatus({ label, status }: { label: string; status: string | undefined }) {
  const granted = status === 'granted';
  return (
    <div className="walkthrough-permission">
      <span>{label}</span>
      <span className={granted ? 'walkthrough-ok' : 'walkthrough-pending'}>{granted ? 'Allowed' : status === 'denied' ? 'Blocked' : 'Not yet allowed'}</span>
    </div>
  );
}

export default function Walkthrough({ user, onDone }: WalkthroughProps) {
  const [index, setIndex] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);

  const refreshRuntime = () => {
    void window.electronAPI?.getRuntimeInfo().then(setRuntime).catch(() => {});
  };
  useEffect(refreshRuntime, []);

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [
      {
        key: 'welcome',
        icon: <Sparkles size={28} />,
        title: `Welcome, ${user.username}`,
        body: (
          <>
            <p>AgentZero listens to your meetings, writes a live transcript in English and Indian languages, and turns it into highlights, action items and Minutes of Meeting.</p>
            <p>This short tour shows how it works. You can skip it now and reopen it from Settings → About.</p>
          </>
        ),
      },
    ];

    if (user.isAdmin) {
      list.push({
        key: 'keys',
        icon: <KeyRound size={28} />,
        title: 'Connect the AI services',
        body: (
          <>
            <p>Open <strong>Settings → AI &amp; Transcription</strong> once and add:</p>
            <ul>
              <li><strong>Google Cloud project ID</strong> and its <strong>service account key</strong> (JSON file). All AI runs on Vertex AI in Mumbai.</li>
              <li><strong>Sarvam API key</strong> for transcription.</li>
            </ul>
            <p>Then press <strong>Test AI connection</strong>. Keys are stored encrypted on this computer only.</p>
          </>
        ),
      });
    }

    if (runtime?.isMac) {
      list.push({
        key: 'mac',
        icon: <ShieldCheck size={28} />,
        title: 'Allow microphone access on your Mac',
        body: (
          <>
            <p>macOS asks once before an app can use the microphone. Allow it so AgentZero can transcribe.</p>
            <PermissionStatus label="Microphone" status={runtime.macPermissions?.microphone} />
            <PermissionStatus label="Screen Recording (online meetings only)" status={runtime.macPermissions?.screen} />
            <div className="walkthrough-buttons">
              <button className="setting-save-btn" onClick={() => void window.electronAPI.requestMicrophoneAccess().then(refreshRuntime)}>
                <Mic size={14} /> Allow microphone
              </button>
              <button className="setting-link-btn" onClick={() => void window.electronAPI.openMacPrivacySettings('microphone')}>Open Microphone settings</button>
              <button className="setting-link-btn" onClick={() => void window.electronAPI.openMacPrivacySettings('screen')}>Open Screen Recording settings</button>
            </div>
            <p className="walkthrough-small">If you change Screen Recording, macOS may ask you to quit and reopen AgentZero.</p>
          </>
        ),
      });
    }

    list.push(
      {
        key: 'record',
        icon: <Mic size={28} />,
        title: 'Start a meeting',
        body: (
          <>
            <p>Press <strong>Start Recording</strong> on the Dashboard, confirm everyone has agreed to be recorded, and pick the meeting type:</p>
            <div className="walkthrough-modes">
              <div><Users size={18} /><strong>In person</strong><span>Microphone only. No video is recorded.</span></div>
              <div><MonitorPlay size={18} /><strong>Online</strong><span>Also records your screen, for Zoom, Teams or Meet calls.</span></div>
            </div>
          </>
        ),
      },
      {
        key: 'live',
        icon: <Sparkles size={28} />,
        title: 'During the meeting',
        body: (
          <ul>
            <li>The <strong>live transcript</strong> fills in as people speak, in any of 22 Indian languages or English.</li>
            <li><strong>Live questions</strong>, <strong>jargon explained</strong> and <strong>suggestions</strong> build up as the conversation goes.</li>
            <li>Ask <strong>QuickLook</strong> anything about what has been said so far.</li>
          </ul>
        ),
      },
      {
        key: 'after',
        icon: <FileText size={28} />,
        title: 'After the meeting',
        body: (
          <ul>
            <li>Highlights, key points and action items appear a few seconds after you stop.</li>
            <li>Export the <strong>Minutes of Meeting</strong> as PDF or Markdown.</li>
            <li>Every meeting stays in <strong>Past Meetings</strong> on this computer.</li>
          </ul>
        ),
      },
    );
    return list;
  }, [runtime, user]);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title">
      <div className="modal-card walkthrough-card">
        <div className="walkthrough-progress" aria-hidden="true">
          {steps.map((s, i) => <span key={s.key} className={i <= index ? 'walkthrough-dot-on' : ''} />)}
        </div>
        <div className="modal-icon-wrap">{step.icon}</div>
        <h3 className="modal-title" id="walkthrough-title">{step.title}</h3>
        <div className="walkthrough-body">{step.body}</div>
        <div className="modal-actions">
          {index === 0
            ? <button className="modal-btn modal-btn-cancel" onClick={onDone}>Skip tour</button>
            : <button className="modal-btn modal-btn-cancel" onClick={() => setIndex(index - 1)}><ArrowLeft size={14} /> Back</button>}
          <button className="modal-btn modal-btn-accept" onClick={() => (isLast ? onDone() : setIndex(index + 1))}>
            {isLast ? 'Get started' : <>Next <ArrowRight size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
