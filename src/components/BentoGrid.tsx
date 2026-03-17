import { useState } from 'react';
import LiveTranscript from './LiveTranscript';
import JargonExplainer from './JargonExplainer';
import type { JargonItem } from './JargonExplainer';
import LiveQuestions from './LiveQuestions';
import type { QuestionItem } from './LiveQuestions';
import TodoList from './TodoList';
import type { TodoItem } from './TodoList';
import AISuggestions from './AISuggestions';
import type { SuggestionItem } from './AISuggestions';
import QuickLookChat from './QuickLookChat';

/* ─── Props ─── */
interface BentoGridProps {
  stream: MediaStream | null;
  listenerName: string;
}

/* ─── Component ─── */
export default function BentoGrid({ stream: _stream, listenerName }: BentoGridProps) {
  /* --- Mock data (will be replaced by Deepgram / Groq later) --- */

  const [jargonItems] = useState<JargonItem[]>([
    { id: 1, term: 'RAG', explanation: 'Retrieval-Augmented Generation — combines LLM responses with relevant document retrieval.' },
    { id: 2, term: 'LLM', explanation: 'Large Language Model — AI models trained on massive text datasets.' },
  ]);

  const [questions, setQuestions] = useState<QuestionItem[]>([
    { id: 1, text: 'What is the deadline for the project?', resolved: false },
    { id: 2, text: 'Who is responsible for the backend API?', resolved: false },
    { id: 3, text: 'Are there any blockers for the next sprint?', resolved: false },
  ]);

  const [todos, setTodos] = useState<TodoItem[]>([
    { id: 1, text: 'Review API documentation', done: false },
    { id: 2, text: 'Schedule follow-up meeting', done: false },
  ]);

  const [suggestions] = useState<SuggestionItem[]>([
    { id: 1, text: 'Consider clarifying the deployment timeline with the team.', type: 'action' },
    { id: 2, text: 'Multiple speakers seem uncertain about the database choice.', type: 'insight' },
  ]);

  /* --- Handlers --- */

  const handleToggleQuestion = (id: number) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, resolved: !q.resolved } : q))
    );
  };

  const handleToggleTodo = (id: number) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  };

  const handleAddTodo = (text: string) => {
    setTodos((prev) => [...prev, { id: Date.now(), text, done: false }]);
  };

  /* --- Render --- */

  return (
    <div className="bento-grid">
      {/* ── Left Column (40%) ── */}
      <div className="bento-left">
        <LiveTranscript />
        <JargonExplainer items={jargonItems} />
      </div>

      {/* ── Right Column (60%) ── */}
      <div className="bento-right">
        {/* Top: Live Questions (30%) */}
        <LiveQuestions questions={questions} onToggle={handleToggleQuestion} />

        {/* Bottom: split into two sub-columns */}
        <div className="bento-right-bottom">
          {/* Left sub-column: To-Dos + AI Suggestions stacked */}
          <div className="bento-right-bottom-left">
            <TodoList items={todos} onToggle={handleToggleTodo} onAdd={handleAddTodo} />
            <AISuggestions suggestions={suggestions} />
          </div>

          {/* Right sub-column: QuickLook chat full height */}
          <div className="bento-right-bottom-right">
            <QuickLookChat listenerName={listenerName} />
          </div>
        </div>
      </div>
    </div>
  );
}
