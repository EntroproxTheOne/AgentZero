import { useEffect, useState } from 'react';
import { AlertCircle, Mic, MicOff, MonitorPlay, MonitorOff, Volume2, VolumeX } from 'lucide-react';
import { levelBus, type CaptureControls, type CaptureState } from './capture';
import VideoSourcePicker from './VideoSourcePicker';

interface CaptureBarProps {
  state: CaptureState;
  controls: CaptureControls | null;
  /** Live transcription connection (Sarvam). */
  transcriptStatus?: { state: 'live' | 'reconnecting' | 'lost'; detail: string | null } | null;
}

/** Loudness 0..1 RMS -> 0..100 % on a log-ish scale that suits speech. */
const toPercent = (rms: number) => Math.max(0, Math.min(100, Math.round((Math.log10(Math.max(rms, 1e-4)) + 3.2) * 40)));

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="level-meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span className="level-meter-fill" style={{ width: `${value}%` }} />
    </span>
  );
}

/** What the meeting is recording, with separate mic / computer-sound level meters. */
export default function CaptureBar({ state, controls, transcriptStatus }: CaptureBarProps) {
  const [busy, setBusy] = useState<'mic' | 'sound' | null>(null);
  const [levels, setLevels] = useState({ mic: 0, system: 0 });

  useEffect(() => levelBus.subscribe((next) => setLevels({ mic: toPercent(next.mic), system: toPercent(next.system) })), []);

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
        Mic
        <Meter value={state.microphone ? levels.mic : 0} label="Microphone level" />
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
        {busy === 'sound' ? 'Connecting…' : 'Call audio'}
        <Meter value={state.computerSound ? levels.system : 0} label="Computer sound level" />
      </button>
      <span
        className={`capture-chip capture-chip-static ${state.screenVideo ? 'capture-chip-on' : ''}`}
        title={state.screenVideo ? 'The screen is being recorded (MP4).' : 'Audio only: saved as MP3, no video.'}
      >
        {state.screenVideo ? <MonitorPlay size={14} /> : <MonitorOff size={14} />}
        {state.screenVideo ? 'Screen video' : 'Audio only'}
      </span>
      {state.screenVideo && controls && controls.detectedApps.length > 0 && (
        <VideoSourcePicker
          detectedApps={controls.detectedApps}
          value={state.videoSource ?? 'auto'}
          onChange={(id) => { void controls.setVideoSource(id); }}
          className="capture-source-inline"
        />
      )}
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
