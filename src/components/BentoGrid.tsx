import { useEffect, useMemo, useState } from 'react';
import AISuggestions from './AISuggestions';
import type { SuggestionItem } from './AISuggestions';
import JargonExplainer from './JargonExplainer';
import type { JargonItem } from './JargonExplainer';
import LiveQuestions from './LiveQuestions';
import type { QuestionItem } from './LiveQuestions';
import LiveTranscript from './LiveTranscript';
import QuickLookChat from './QuickLookChat';
import TodoList from './TodoList';
import type { TodoItem } from './TodoList';
import type { LiveInsightsPayload } from '../types/meeting';

interface BentoGridProps {
  meetingId: number | null;
  listenerName: string;
}

const emptyLiveInsights: LiveInsightsPayload = {
  status: 'idle',
  updatedAt: null,
  error: null,
  jargon: [],
  liveQuestions: [],
  suggestions: [],
};

export default function BentoGrid({ meetingId, listenerName }: BentoGridProps) {
  const [liveInsights, setLiveInsights] = useState<LiveInsightsPayload>(emptyLiveInsights);
  const [resolvedQuestionIds, setResolvedQuestionIds] = useState<string[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    if (!meetingId || !window.electronAPI?.onLiveInsights) return;

    window.electronAPI.onLiveInsights((event) => {
      if (event.meetingId !== meetingId) return;
      setLiveInsights(event.payload);
      const activeIds = new Set(
        event.payload.liveQuestions.map((item, index) => (
          item.id ?? buildFallbackId('question', `${item.text}-${index}`)
        )),
      );
      setResolvedQuestionIds((previous) => previous.filter((id) => activeIds.has(id)));
    });

    return () => {
      window.electronAPI.offLiveInsights?.();
    };
  }, [meetingId]);

  const jargonItems = useMemo<JargonItem[]>(
    () => [...liveInsights.jargon]
      .sort((left, right) => getInsightTimestamp(right.lastSeenAt ?? right.detectedAt) - getInsightTimestamp(left.lastSeenAt ?? left.detectedAt))
      .map((item, index) => ({
        id: item.id ?? buildFallbackId('jargon', `${item.term}-${index}`),
        term: item.term,
        explanation: item.explanation,
      })),
    [liveInsights.jargon],
  );

  const questions = useMemo<QuestionItem[]>(
    () => liveInsights.liveQuestions.map((item, index) => {
      const id = item.id ?? buildFallbackId('question', `${item.text}-${index}`);
      return {
        id,
        text: item.text,
        resolved: resolvedQuestionIds.includes(id),
      };
    }),
    [liveInsights.liveQuestions, resolvedQuestionIds],
  );

  const suggestions = useMemo<SuggestionItem[]>(
    () => liveInsights.suggestions.map((item, index) => ({
      id: item.id ?? buildFallbackId('suggestion', `${item.type}-${item.text}-${index}`),
      text: item.text,
      type: item.type,
    })),
    [liveInsights.suggestions],
  );

  const recommendedTodo = useMemo(
    () => suggestions.find((item) => item.type === 'action')?.text ?? null,
    [suggestions],
  );

  const handleToggleQuestion = (id: string) => {
    setResolvedQuestionIds((previous) => (
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    ));
  };

  const handleToggleTodo = (id: number) => {
    setTodos((previous) =>
      previous.map((item) => item.id === id ? { ...item, done: !item.done } : item),
    );
  };

  const handleAddTodo = (text: string) => {
    setTodos((previous) => [...previous, { id: Date.now(), text, done: false }]);
  };

  return (
    <div className="bento-grid">
      <div className="bento-left">
        <LiveTranscript meetingId={meetingId} />
        <JargonExplainer items={jargonItems} />
      </div>

      <div className="bento-right">
        <LiveQuestions questions={questions} onToggle={handleToggleQuestion} />

        <div className="bento-right-bottom">
          <div className="bento-right-bottom-left">
            <TodoList
              items={todos}
              onToggle={handleToggleTodo}
              onAdd={handleAddTodo}
              recommendedText={recommendedTodo}
            />
            <AISuggestions suggestions={suggestions} />
          </div>

          <div className="bento-right-bottom-right">
            <QuickLookChat listenerName={listenerName} meetingId={meetingId} />
          </div>
        </div>
      </div>
    </div>
  );
}

function buildFallbackId(prefix: string, value: string) {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function getInsightTimestamp(value?: string | null) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
