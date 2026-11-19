import { ShieldAlert, Mic, Volume2, MonitorPlay, NotebookPen, Radio, Users, Video } from 'lucide-react';
import ContextPicker from './ContextPicker';
import VideoSourcePicker from './VideoSourcePicker';
import type { MeetingContextValue } from './meetingContext';
import type { CaptureChoice } from './capture';
import type { RecordingMode } from '../types/meeting';
import { useWorkspace } from '../hooks/useWorkspace';

interface ConsentModalProps {
  detectedApps: string[];
  capture: CaptureChoice;
  onCaptureChange: (value: CaptureChoice) => void;
  context: MeetingContextValue;
  onContextChange: (value: MeetingContextValue) => void;
  mode: RecordingMode;
  onModeChange: (value: RecordingMode) => void;
  videoSource: string;
  onVideoSourceChange: (value: string) => void;
  onAccept: () => void;
  onCancel: () => void;
}

export default function ConsentModal({
  detectedApps, capture, onCaptureChange, context, onContextChange, mode, onModeChange, videoSource, onVideoSourceChange, onAccept, onCancel,
}: ConsentModalProps) {
  const { clients, projects } = useWorkspace();

  const noSound = !capture.microphone && !capture.computerSound;
  const online = capture.computerSound;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="start-meeting-title">
      <div className="modal-card modal-card-wide">
        <div className="modal-head">
          <div className="modal-icon-wrap modal-icon-small">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h3 className="modal-title" id="start-meeting-title">Start a meeting</h3>
            {detectedApps.length > 0 && (
              <div className="modal-detected">
                <span className="modal-detected-label">Detected:</span>
                {detectedApps.map((app) => (
                  <span key={app} className="modal-detected-tag">{app}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <h4 className="modal-section-label">Meeting</h4>
        <div className="choice-pair" role="radiogroup" aria-label="Meeting type">
          <button
            type="button"
            role="radio"
            aria-checked={online}
            className={`choice-card ${online ? 'choice-card-on' : ''}`}
            onClick={() => onCaptureChange({ ...capture, microphone: true, computerSound: true })}
          >
            <Video size={18} />
            <span className="choice-title">Online</span>
            <span className="choice-sub">Zoom, Teams, Meet… records your mic and the call audio</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!online}
            className={`choice-card ${!online ? 'choice-card-on' : ''}`}
            onClick={() => onCaptureChange({ ...capture, microphone: true, computerSound: false, screenVideo: false })}
          >
            <Users size={18} />
            <span className="choice-title">In person</span>
            <span className="choice-sub">Microphone only</span>
          </button>
        </div>

        <h4 className="modal-section-label">Mode</h4>
        <div className="choice-pair" role="radiogroup" aria-label="Recording mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'notes'}
            className={`choice-card ${mode === 'notes' ? 'choice-card-on' : ''}`}
            onClick={() => onModeChange('notes')}
          >
            <NotebookPen size={18} />
            <span className="choice-title">Notes</span>
            <span className="choice-sub">Nothing on screen while you talk. Transcript, speakers and summary after the meeting.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'live'}
            className={`choice-card ${mode === 'live' ? 'choice-card-on' : ''}`}
            onClick={() => onModeChange('live')}
          >
            <Radio size={18} />
            <span className="choice-title">Live <em className="choice-tag">Best for 1:1 meetings</em></span>
            <span className="choice-sub">Live transcript labelled You / Client, and Quick Ask during the meeting.</span>
          </button>
        </div>

        <h4 className="modal-section-label">What to record</h4>
        <div className="capture-list">
          <label className="capture-row">
            <Mic size={18} />
            <span className="capture-text">
              <span className="capture-title">Microphone</span>
              <span className="capture-sub">Your voice, and everyone in the room.</span>
            </span>
            <input
              type="checkbox"
              className="capture-switch"
              checked={capture.microphone}
              onChange={(e) => onCaptureChange({ ...capture, microphone: e.target.checked })}
            />
          </label>
          <label className="capture-row">
            <Volume2 size={18} />
            <span className="capture-text">
              <span className="capture-title">Computer sound</span>
              <span className="capture-sub">The other people on the call. Kept separate from your mic to tell who said what.</span>
            </span>
            <input
              type="checkbox"
              className="capture-switch"
              checked={capture.computerSound}
              onChange={(e) => onCaptureChange({ ...capture, computerSound: e.target.checked })}
            />
          </label>
          <label className="capture-row">
            <MonitorPlay size={18} />
            <span className="capture-text">
              <span className="capture-title">Screen video</span>
              <span className="capture-sub">Saves a video of the screen as MP4. Off saves audio only (MP3).</span>
            </span>
            <input
              type="checkbox"
              className="capture-switch"
              checked={capture.screenVideo}
              onChange={(e) => onCaptureChange({ ...capture, screenVideo: e.target.checked })}
            />
          </label>
          {capture.screenVideo && detectedApps.length > 0 && (
            <label className="capture-row capture-source-row">
              <span className="capture-text">
                <span className="capture-title">Show in the video</span>
                <span className="capture-sub">You can switch this during the meeting. Call audio is recorded either way.</span>
              </span>
              <VideoSourcePicker detectedApps={detectedApps} value={videoSource} onChange={onVideoSourceChange} />
            </label>
          )}
        </div>
        <p className="capture-note">
          {noSound
            ? 'Turn on the microphone or computer sound: at least one is needed for the transcript.'
            : 'You can switch the microphone and computer sound on or off during the meeting.'}
        </p>

        <h4 className="modal-section-label">Client <em>(optional, helps name speakers and find past meetings)</em></h4>
        <ContextPicker value={context} onChange={onContextChange} clients={clients} projects={projects} compact />

        <p className="modal-text modal-consent">
          Before recording I have taken full consent of all attendees of the meeting to record it for my personal use.
        </p>

        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal-btn modal-btn-accept" onClick={onAccept} disabled={noSound}>
            Start recording
          </button>
        </div>
      </div>
    </div>
  );
}
