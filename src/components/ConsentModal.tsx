import { ShieldAlert, Mic, Volume2, MonitorPlay } from 'lucide-react';
import ContextPicker from './ContextPicker';
import type { MeetingContextValue } from './meetingContext';
import type { CaptureChoice } from './capture';
import { useWorkspace } from '../hooks/useWorkspace';


interface ConsentModalProps {
  detectedApps: string[];
  capture: CaptureChoice;
  onCaptureChange: (value: CaptureChoice) => void;
  context: MeetingContextValue;
  onContextChange: (value: MeetingContextValue) => void;
  identifySpeakers: boolean;
  onIdentifySpeakersChange: (value: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
}

export default function ConsentModal({
  detectedApps, capture, onCaptureChange, context, onContextChange, identifySpeakers, onIdentifySpeakersChange, onAccept, onCancel,
}: ConsentModalProps) {
  const { clients, projects } = useWorkspace();
  const noSound = !capture.microphone && !capture.computerSound;

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

        <h4 className="modal-section-label">What to record</h4>
        <div className="capture-list">
          <label className="capture-row">
            <Mic size={18} />
            <span className="capture-text">
              <span className="capture-title">Microphone</span>
              <span className="capture-sub">Your voice, and everyone in the room for in-person meetings.</span>
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
              <span className="capture-sub">The other people on a call (Zoom, Teams, Meet…). Off for in-person meetings.</span>
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
        </div>
        <p className="capture-note">
          {noSound
            ? 'Turn on the microphone or computer sound: at least one is needed for the transcript.'
            : 'You can switch the microphone and computer sound on or off during the meeting.'}
        </p>

        <h4 className="modal-section-label">Context <em>(optional)</em></h4>
        <ContextPicker value={context} onChange={onContextChange} clients={clients} projects={projects} compact />

        <label className="upload-toggle">
          <input type="checkbox" checked={identifySpeakers} onChange={(e) => onIdentifySpeakersChange(e.target.checked)} />
          <span>
            <strong>Identify speakers</strong> after the meeting (Speaker 1, Speaker 2…)
            <em>Adds ₹0.10 per minute of audio (₹0.59 instead of ₹0.49)</em>
          </span>
        </label>

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
