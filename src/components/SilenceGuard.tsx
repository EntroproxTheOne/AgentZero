import { useEffect, useRef, useState } from 'react';
import { MicOff } from 'lucide-react';
import { levelBus } from './capture';

interface SilenceGuardProps {
  onStop: () => void;
}

const VOICE_RMS = 0.015;
const ASK_AFTER_MS = 10 * 60_000;
// No answer and still silent: stop, so a forgotten recording does not keep costing.
const AUTO_STOP_AFTER_MS = 10 * 60_000;

/** While recording: if nobody has spoken for 10 minutes, bring the app forward and ask. */
export default function SilenceGuard({ onStop }: SilenceGuardProps) {
  const lastVoiceRef = useRef(0);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const onStopRef = useRef(onStop);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);

  useEffect(() => {
    lastVoiceRef.current = Date.now();
    return levelBus.subscribe(({ mic, system }) => {
    if (Math.max(mic, system) > VOICE_RMS) lastVoiceRef.current = Date.now();
  });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const silentFor = now - lastVoiceRef.current;
      if (askedAt === null && silentFor >= ASK_AFTER_MS) {
        setAskedAt(now);
        void window.electronAPI?.requestAttention({
          title: 'Still recording',
          body: 'No one has spoken for 10 minutes. Stop the recording if the meeting is over.',
        });
      } else if (askedAt !== null && lastVoiceRef.current > askedAt) {
        setAskedAt(null); // someone spoke again
      } else if (askedAt !== null && now - askedAt >= AUTO_STOP_AFTER_MS) {
        setAskedAt(null);
        onStopRef.current();
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [askedAt]);

  if (askedAt === null) return null;
  return (
    <div className="modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="silence-title">
      <div className="modal-card">
        <div className="modal-head">
          <div className="modal-icon-wrap modal-icon-small"><MicOff size={20} /></div>
          <h3 className="modal-title" id="silence-title">Still in a meeting?</h3>
        </div>
        <p className="modal-text">
          No one has spoken for 10 minutes. If the meeting is over, stop the recording. It stops by itself in 10 more minutes of silence.
        </p>
        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={() => { lastVoiceRef.current = Date.now(); setAskedAt(null); }}>Keep recording</button>
          <button className="modal-btn modal-btn-accept" onClick={() => { setAskedAt(null); onStop(); }}>Stop recording</button>
        </div>
      </div>
    </div>
  );
}
