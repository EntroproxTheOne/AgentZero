import { useState, useRef, useEffect } from 'react';
import { Notebook, Search, Sparkles, Send } from 'lucide-react';

interface TranscriptEntry {
  id: number;
  speaker: string;
  text: string;
  timestamp: number;
}

interface AnalysisModeProps {
  stream: MediaStream | null;
  listenerName: string;
}

export default function AnalysisMode({ stream, listenerName }: AnalysisModeProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // Mock transcript — will be replaced with real Deepgram data in Phase 6
  const [transcripts] = useState<TranscriptEntry[]>([
    { id: 1, speaker: 'System', text: 'Waiting for transcription service...', timestamp: Date.now() },
  ]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const handleAsk = async () => {
    if (!aiQuestion.trim()) return;
    const question = aiQuestion;
    setAiQuestion('');
    setAiMessages((prev) => [...prev, { role: 'user', text: question }]);
    setAiLoading(true);

    // Mock — will be Groq API in Phase 7
    setTimeout(() => {
      setAiMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: `Based on the meeting transcript, here's what I found about "${question}": This will be powered by Groq in Phase 7. It will analyze the full transcript and provide contextual answers, detect when "${listenerName}" is mentioned, and generate quick summaries.`,
        },
      ]);
      setAiLoading(false);
    }, 1200);
  };

  return (
    <div className="analysis-container">
      {/* Top: Video + QuickRead side by side */}
      <div className="analysis-top">
        <div className="analysis-video-wrap">
          <div className="analysis-video-header">
            <div className="analysis-live-badge">
              <div className="analysis-live-dot" />
              LIVE
            </div>
          </div>
          <video ref={videoRef} autoPlay muted className="analysis-video" />
          {!stream && (
            <div className="analysis-video-placeholder">
              <p>No active recording. Start recording to see live preview.</p>
            </div>
          )}
        </div>

        {/* QuickRead — Live Transcript */}
        <div className="analysis-transcript">
          <div className="analysis-panel-header">
            <Notebook size={16} />
            <span>QuickRead</span>
          </div>
          <div className="analysis-transcript-list">
            {transcripts.map((entry) => (
              <div key={entry.id} className="transcript-entry">
                <div className="transcript-meta">
                  <span className="transcript-speaker">{entry.speaker}</span>
                  <span className="transcript-time">{formatTime(entry.timestamp)}</span>
                </div>
                <p className="transcript-text">{entry.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </div>

      {/* Bottom: QuickLook */}
      <div className="analysis-bottom">
        <div className="analysis-panel-header">
          <Search size={16} />
          <span>QuickLook</span>
          <span className="analysis-listening-tag">Listening for "{listenerName}"</span>
        </div>

        <div className="ai-chat-area">
          {aiMessages.length === 0 && !aiLoading && (
            <div className="ai-empty">
              Ask anything about the meeting, or it will auto-respond when "{listenerName}" is mentioned.
            </div>
          )}
          {aiMessages.map((msg, i) => (
            <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
              {msg.role === 'ai' && <Sparkles size={14} className="ai-msg-icon" />}
              <p>{msg.text}</p>
            </div>
          ))}
          {aiLoading && (
            <div className="ai-msg ai-msg-ai">
              <div className="recorder-spinner" style={{ width: 14, height: 14 }} />
              <p>Thinking...</p>
            </div>
          )}
        </div>

        <div className="ai-input-wrap">
          <input
            type="text"
            placeholder="Ask about the meeting..."
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            className="ai-input"
          />
          <button
            className="ai-send"
            onClick={handleAsk}
            disabled={aiLoading || !aiQuestion.trim()}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
