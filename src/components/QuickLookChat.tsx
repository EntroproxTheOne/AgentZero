import { useEffect, useRef, useState } from 'react';
import { Search, Send, Sparkles } from 'lucide-react';
import type { QuickLookHistoryItem } from '../types/meeting';

interface QuickLookChatProps {
  listenerName: string;
  meetingId: number | null;
}

export default function QuickLookChat({ listenerName, meetingId }: QuickLookChatProps) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<QuickLookHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const chatAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages([]);
    setQuestion('');
    setLoading(false);
    setError('');
  }, [meetingId]);

  useEffect(() => {
    if (!chatAreaRef.current) return;
    chatAreaRef.current.scrollTo({
      top: chatAreaRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, loading, error]);

  const handleAsk = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !meetingId || !window.electronAPI) return;

    const nextMessages: QuickLookHistoryItem[] = [...messages, { role: 'user', text: trimmedQuestion }];
    setQuestion('');
    setMessages(nextMessages);
    setLoading(true);
    setError('');

    try {
      const response = await window.electronAPI.askQuickLook({
        meetingId,
        question: trimmedQuestion,
        history: messages,
      });

      setMessages((previous) => [...previous, {
        role: 'ai',
        text: response.answer,
        usedSearch: response.usedSearch,
      }]);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'QuickLook could not answer right now.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bento-panel bento-quicklook">
      <div className="bento-panel-header">
        <Search size={16} />
        <span>QuickLook</span>
        <span className="bento-listening-tag">Listening for "{listenerName}"</span>
      </div>

      <div ref={chatAreaRef} className="ai-chat-area">
        {messages.length === 0 && !loading && !error && (
          <div className="ai-empty">
            Ask anything about the meeting and QuickLook will answer from the transcript.
          </div>
        )}

        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`ai-msg ai-msg-${message.role}`}>
            {message.role === 'ai' ? (
              <>
                <Sparkles size={14} className="ai-msg-icon" />
                <div className="ai-msg-content">
                  <p>{message.text}</p>
                  {message.usedSearch && (
                    <span
                      className="ai-search-indicator"
                      title="Gemini used Google Search grounding for this answer"
                    >
                      <Search size={11} />
                      Web search used
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p>{message.text}</p>
            )}
          </div>
        ))}

        {loading && (
          <div className="ai-msg ai-msg-ai">
            <div className="recorder-spinner" style={{ width: 14, height: 14 }} />
            <p>Thinking...</p>
          </div>
        )}

        {error && (
          <div className="ai-msg ai-msg-ai">
            <Sparkles size={14} className="ai-msg-icon" />
            <p>{error}</p>
          </div>
        )}
      </div>

      <div className="ai-input-wrap">
        <input
          type="text"
          placeholder="Ask about the meeting..."
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleAsk();
            }
          }}
          className="ai-input"
        />
        <button
          className="ai-send"
          onClick={() => void handleAsk()}
          disabled={loading || !question.trim() || !meetingId}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
