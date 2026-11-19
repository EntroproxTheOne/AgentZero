import { useEffect, useState } from 'react';
import { NotebookPen, Radio } from 'lucide-react';

interface NotesRecordingProps {
  meetingId: number;
  startTime: number;
  onWentLive: () => void;
}

const LIVE_RATE_INR_PER_MIN = 0.49;

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

/** Notes mode while recording: a timer (meters are in the capture bar) and "Go live". */
export default function NotesRecording({ meetingId, startTime, onWentLive }: NotesRecordingProps) {
  const [now, setNow] = useState(Date.now());
  const [asking, setAsking] = useState(false);
  const [catchUp, setCatchUp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedMs = now - startTime;
  const catchUpCost = (elapsedMs / 60000) * LIVE_RATE_INR_PER_MIN;

  const goLive = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.goLive({ meetingId, catchUp });
      onWentLive();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notes-recording">
      <NotebookPen size={28} className="notes-recording-icon" />
      <div className="notes-recording-timer" aria-live="off">{formatElapsed(elapsedMs)}</div>
      <p className="notes-recording-text">
        Recording. Focus on the conversation: the transcript, speakers and summary are ready shortly after you stop.
      </p>
      {!asking ? (
        <button type="button" className="setting-link-btn notes-go-live" onClick={() => setAsking(true)}>
          <Radio size={14} /> Go live
        </button>
      ) : (
        <div className="notes-go-live-card">
          <p><strong>Switch to Live?</strong> A live transcript (You / Client) and Quick Ask start from now.</p>
          <label className="upload-toggle">
            <input type="checkbox" checked={catchUp} onChange={(e) => setCatchUp(e.target.checked)} />
            <span>
              <strong>Catch up on the earlier part</strong>
              <em>Transcribes the {Math.max(1, Math.round(elapsedMs / 60000))} min recorded so far (≈₹{catchUpCost.toFixed(2)})</em>
            </span>
          </label>
          {error && <p className="capture-problem">{error}</p>}
          <div className="modal-actions">
            <button className="modal-btn modal-btn-cancel" onClick={() => setAsking(false)} disabled={busy}>Stay in Notes</button>
            <button className="modal-btn modal-btn-accept" onClick={() => void goLive()} disabled={busy}>
              {busy ? 'Starting…' : 'Go live'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
