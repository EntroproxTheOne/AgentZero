import { useRef, useEffect } from 'react';
import { Notebook } from 'lucide-react';

/* ─── Types ─── */
export interface TranscriptEntry {
  id: number;
  speaker: string;
  text: string;
  timestamp: number;
}

interface LiveTranscriptProps {
  entries: TranscriptEntry[];
}

/* ─── Audio Waveform Visualizer ─── */
function AudioWaveform() {
  return (
    <div className="waveform-container">
      <div className="waveform-status">
        <div className="waveform-dot" />
        <span>Recording</span>
      </div>
      <div className="waveform-bars">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="waveform-bar"
            style={{ animationDelay: `${i * 0.07}s` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Component ─── */
export default function LiveTranscript({ entries }: LiveTranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="bento-panel bento-transcript">
      <AudioWaveform />

      <div className="bento-panel-header">
        <Notebook size={16} />
        <span>Live Transcript</span>
      </div>

      <div className="bento-transcript-list">
        {entries.map((entry) => (
          <div key={entry.id} className="transcript-entry">
            <div className="transcript-meta">
              <span className="transcript-speaker">{entry.speaker}</span>
              <span className="transcript-time">{formatTime(entry.timestamp)}</span>
            </div>
            <p className="transcript-text">{entry.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
