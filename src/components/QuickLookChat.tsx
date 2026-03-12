import { useState } from 'react';
import { Search, Sparkles, Send } from 'lucide-react';

/* ─── Types ─── */
interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

interface QuickLookChatProps {
  listenerName: string;
}

/* ─── Component ─── */
export default function QuickLookChat({ listenerName }: QuickLookChatProps) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    const q = question.trim();
    if (!q) return;
    setQuestion('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setLoading(true);

    // Mock — will be Groq RAG in a later phase
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: `Based on the meeting transcript, here's what I found about "${q}": This will be powered by Groq RAG. It will analyze the full transcript and provide contextual answers.`,
        },
      ]);
      setLoading(false);
    }, 1200);
  };

  return (
    <div className="bento-panel bento-quicklook">
      <div className="bento-panel-header">
        <Search size={16} />
        <span>QuickLook</span>
        <span className="bento-listening-tag">Listening for "{listenerName}"</span>
      </div>

      <div className="ai-chat-area">
        {messages.length === 0 && !loading && (
          <div className="ai-empty">
            Ask anything about the meeting, or it will auto-respond when "{listenerName}" is mentioned.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
            {msg.role === 'ai' && <Sparkles size={14} className="ai-msg-icon" />}
            <p>{msg.text}</p>
          </div>
        ))}
        {loading && (
          <div className="ai-msg ai-msg-ai">
            <div className="recorder-spinner" style={{ width: 14, height: 14 }} />
            <p>Thinking…</p>
          </div>
        )}
      </div>

      <div className="ai-input-wrap">
        <input
          type="text"
          placeholder="Ask about the meeting…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          className="ai-input"
        />
        <button
          className="ai-send"
          onClick={handleAsk}
          disabled={loading || !question.trim()}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
