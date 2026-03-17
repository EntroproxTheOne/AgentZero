import { useRef, useEffect, useState } from 'react';
import { Notebook, Mic2 } from 'lucide-react';


/* ─── Individual transcript entry ─── */
function TranscriptLine({ entry, interim }: { entry: TranscriptEntry; interim?: boolean }) {
  const isYou = entry.source === 'you';
  const speakerLabel = isYou
    ? 'You'
    : entry.speakerId != null
    ? `Speaker ${entry.speakerId + 1}`
    : 'Meeting';

  return (
    <div className={`transcript-entry${interim ? ' transcript-interim' : ''}`}>
      <div className="transcript-meta">
        <span className={`transcript-speaker${isYou ? ' transcript-speaker-you' : ''}`}>
          {isYou ? <><Mic2 size={11} style={{ marginRight: 4 }} />{speakerLabel}</> : speakerLabel}
        </span>
        <span className="transcript-time">{entry.timestamp}</span>
      </div>
      <p className="transcript-text">{entry.transcript}</p>
    </div>
  );
}

function AudioWaveform() {
  return (
    <div className="bento-listening-tag" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div className="waveform-dot" />
      <span>LIVE</span>
      <div className="waveform-bars-mini">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="waveform-bar-mini" style={{ animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function LiveTranscript() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState<TranscriptEntry | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.onTranscriptEntry) return;

    window.electronAPI.onTranscriptEntry((entry) => {
      if (entry.interim) {
        // Show a live preview of in-progress speech
        setInterim(entry);
      } else {
        // Finalized entry — append and clear interim
        setEntries((prev) => [...prev, entry]);
        setInterim(null);
      }
    });

    return () => {
      window.electronAPI.offTranscriptEntry?.();
    };
  }, []);

  // Auto-scroll to bottom as new entries arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, interim]);

  return (
    <div className="bento-panel bento-transcript">
      <div className="bento-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Notebook size={15} />
          <span>Live Transcript</span>
        </div>
        <AudioWaveform />
      </div>

      <div className="bento-transcript-list">
        {entries.length === 0 && !interim && (
          <p className="bento-empty-hint">
            Transcript will appear here as the meeting progresses.
          </p>
        )}

        {entries.map((e, i) => (
          <TranscriptLine key={i} entry={e} />
        ))}

        {/* Interim (in-progress speech) */}
        {interim && <TranscriptLine entry={interim} interim />}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
