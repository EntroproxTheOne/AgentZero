import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessagesSquare, Sparkles } from 'lucide-react';
import { useWorkspace } from '../hooks/useWorkspace';
import type { AskAllAnswer } from '../types/meeting';

interface AskPageProps {
  onOpenMeeting: (dbId: number, title: string) => void;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  answer?: AskAllAnswer;
  error?: boolean;
}

const SUGGESTIONS = [
  'What did we promise this client in the last few meetings?',
  'List every open action item and who owns it.',
  'What concerns has the client raised more than once?',
  'Summarise what was decided about insurance this month.',
];

/** Ask questions across all past meetings (optionally one client or project). */
export default function AskPage({ onOpenMeeting }: AskPageProps) {
  const { clients, projects } = useWorkspace();
  const [clientId, setClientId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  // A new client / project scope starts a fresh conversation: earlier answers may be about someone else.
  const scope = `${clientId ?? ''}|${projectId ?? ''}`;
  const [turnsScope, setTurnsScope] = useState(scope);
  if (turnsScope !== scope) {
    setTurnsScope(scope);
    setTurns([]);
  }

  const ask = async (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    const history = turns.map(({ role, text: turnText }) => ({ role, text: turnText }));
    setTurns((prev) => [...prev, { role: 'user', text: clean }]);
    setQuestion('');
    setBusy(true);
    const result = await window.electronAPI.askAllMeetings({ question: clean, clientId, projectId, history });
    setBusy(false);
    setTurns((prev) => [...prev, result.success
      ? { role: 'assistant', text: result.value.answer, answer: result.value }
      : { role: 'assistant', text: result.error, error: true }]);
  };

  const scopeProjects = clientId ? projects.filter((project) => project.client_id === clientId) : projects;

  return (
    <div className="page-container ask-page">
      <header className="page-header page-header-row">
        <div>
          <h2 className="page-label">Across all meetings</h2>
          <h3 className="page-title">Ask</h3>
        </div>
        <div className="ask-scope">
          <select className="setting-input" value={clientId ?? ''} onChange={(e) => { setClientId(e.target.value ? Number(e.target.value) : null); setProjectId(null); }} aria-label="Limit to client">
            <option value="">All clients</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <select className="setting-input" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)} aria-label="Limit to project">
            <option value="">All projects</option>
            {scopeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div>
      </header>

      <div className="ask-thread" aria-live="polite">
        {turns.length === 0 && (
          <div className="ask-empty">
            <MessagesSquare size={36} />
            <p>Ask anything about your meetings. Answers come only from your recorded and uploaded meetings, with links to the ones used.</p>
            <div className="ask-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} className="ask-suggestion" onClick={() => void ask(suggestion)}>{suggestion}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, index) => (
          <div key={index} className={`ask-turn ask-turn-${turn.role} ${turn.error ? 'ask-turn-error' : ''}`}>
            <div className="ask-bubble">{turn.text}</div>
            {turn.answer && turn.answer.citations.length > 0 && (
              <div className="ask-citations">
                {turn.answer.citations.map((citation) => (
                  <button key={citation.meetingId} className="ask-citation" onClick={() => onOpenMeeting(citation.meetingId, citation.title ?? 'Meeting')} title={citation.note}>
                    <span className="ask-citation-title">{citation.title}</span>
                    <span className="ask-citation-date">{citation.date}</span>
                  </button>
                ))}
              </div>
            )}
            {turn.answer && (
              <span className="ask-meta">Searched {turn.answer.meetingsSearched} meeting{turn.answer.meetingsSearched === 1 ? '' : 's'}</span>
            )}
          </div>
        ))}
        {busy && (
          <div className="ask-turn ask-turn-assistant">
            <div className="ask-bubble ask-bubble-busy"><Sparkles size={14} /> Reading your meetings…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
        <textarea
          className="setting-input"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          placeholder="e.g. When did we last discuss the education fund, and what was agreed?"
          aria-label="Question"
        />
        <button type="submit" className="ask-send" disabled={busy || !question.trim()} aria-label="Ask"><ArrowUp size={18} /></button>
      </form>
    </div>
  );
}
