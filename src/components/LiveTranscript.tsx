import { useEffect, useRef, useState } from 'react';
import { Mic2, Notebook } from 'lucide-react';
import type { TranscriptEntry } from '../types/meeting';

function TranscriptLine({ entry, interim = false }: { entry: TranscriptEntry; interim?: boolean }) {
  const isYou = entry.source === 'you';
  const speakerLabel = entry.speakerLabel
    ? entry.speakerLabel
    : isYou
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
        {entry.languageCode && (
          <span
            className="transcript-language-tag"
            title={entry.languageProbability != null
              ? `${entry.languageCode} (${Math.round(entry.languageProbability * 100)}% confidence)`
              : entry.languageCode}
          >
            {entry.languageCode}
          </span>
        )}
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
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="waveform-bar-mini"
            style={{ animationDelay: `${index * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
}

interface LiveTranscriptProps {
  meetingId: number | null;
}

export default function LiveTranscript({ meetingId }: LiveTranscriptProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState<TranscriptEntry | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!meetingId || !window.electronAPI?.onTranscriptEntry) return;

    window.electronAPI.onTranscriptEntry((entry) => {
      if (entry.interim) {
        setInterim(entry);
        return;
      }

      setEntries((previous) => [...previous, entry]);
      setInterim(null);
    });

    return () => {
      window.electronAPI.offTranscriptEntry?.();
    };
  }, [meetingId]);

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

        {entries.map((entry, index) => (
          <TranscriptLine key={`${entry.timestamp}-${index}`} entry={entry} />
        ))}

        {interim && <TranscriptLine entry={interim} interim />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
