import { useState } from 'react';
import { AlertCircle, Mic, MicOff, MonitorPlay, MonitorOff, Volume2, VolumeX } from 'lucide-react';
import type { CaptureControls, CaptureState } from './capture';

interface CaptureBarProps {
  state: CaptureState;
  controls: CaptureControls | null;
  /** Live transcription connection (Sarvam). */
  transcriptStatus?: { state: 'live' | 'reconnecting' | 'lost'; detail: string | null } | null;
}

/** What the live meeting is recording, with mic and computer sound switchable. */
export default function CaptureBar({ state, controls, transcriptStatus }: CaptureBarProps) {
  const [busy, setBusy] = useState<'mic' | 'sound' | null>(null);

  const toggle = async (which: 'mic' | 'sound') => {
    if (!controls) return;
    setBusy(which);
    try {
      if (which === 'mic') await controls.setMicrophone(!state.microphone);
      else await controls.setComputerSound(!state.computerSound);
    } finally {
      setBusy(null);
    }
  };

  const silent = !state.microphone && !state.computerSound;

  return (
    <div className="capture-bar" aria-label="What is being recorded">
      <button
        type="button"
        className={`capture-chip ${state.microphone ? 'capture-chip-on' : ''}`}
        onClick={() => void toggle('mic')}
        disabled={!controls || busy !== null}
        aria-pressed={state.microphone}
        title={state.microphone ? 'Microphone is recording. Click to mute.' : 'Microphone is off. Click to turn it on.'}
      >
        {state.microphone ? <Mic size={14} /> : <MicOff size={14} />}
        Mic {state.microphone ? 'on' : 'off'}
      </button>
      <button
        type="button"
        className={`capture-chip ${state.computerSound ? 'capture-chip-on' : ''}`}
        onClick={() => void toggle('sound')}
        disabled={!controls || busy !== null}
        aria-pressed={state.computerSound}
        title={state.computerSound ? 'Recording the other people on the call. Click to stop.' : 'Computer sound is off. Click to record the call audio.'}
      >
        {state.computerSound ? <Volume2 size={14} /> : <VolumeX size={14} />}
        {busy === 'sound' ? 'Connecting…' : `Computer sound ${state.computerSound ? 'on' : 'off'}`}
      </button>
      <span
        className={`capture-chip capture-chip-static ${state.screenVideo ? 'capture-chip-on' : ''}`}
        title={state.screenVideo ? 'The screen is being recorded (MP4).' : 'Audio only: saved as MP3, no video.'}
      >
        {state.screenVideo ? <MonitorPlay size={14} /> : <MonitorOff size={14} />}
        {state.screenVideo ? 'Screen video' : 'Audio only'}
      </span>
      {transcriptStatus?.state === 'reconnecting' && (
        <span className="capture-problem" role="status">
          <AlertCircle size={14} /> Transcript reconnecting… audio is still being recorded.
        </span>
      )}
      {transcriptStatus?.state === 'lost' && (
        <span className="capture-problem" role="status">
          <AlertCircle size={14} /> {transcriptStatus.detail ?? 'Live transcript stopped. It will be rebuilt from the recording after the meeting.'}
        </span>
      )}
      {(state.problem || silent) && (
        <span className="capture-problem" role="status">
          <AlertCircle size={14} />
          {state.problem ?? 'Nothing is being heard: turn on the mic or computer sound.'}
        </span>
      )}
    </div>
  );
}
