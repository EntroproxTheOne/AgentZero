import { useEffect, useMemo, useState } from 'react';
import AISuggestions from './AISuggestions';
import type { SuggestionItem } from './AISuggestions';
import JargonExplainer from './JargonExplainer';
import type { JargonItem } from './JargonExplainer';
import LiveQuestions from './LiveQuestions';
import type { QuestionItem } from './LiveQuestions';
import LiveTranscript from './LiveTranscript';
import QuickLookChat from './QuickLookChat';
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
  // Auto-insights are opt-in (Settings, Live mode only); without them only the transcript and Quick Ask show.
  const [insightsOn, setInsightsOn] = useState(false);
  useEffect(() => {
    void window.electronAPI?.getAppSettings().then((settings) => setInsightsOn(settings.autoInsightsMinutes > 0)).catch(() => {});
  }, []);

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

  const handleToggleQuestion = (id: string) => {
    setResolvedQuestionIds((previous) => (
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    ));
  };

  // One tree whether or not insights are on, so the transcript never remounts (and loses lines).
  return (
    <div className={`bento-grid ${insightsOn ? '' : 'bento-grid-simple'}`}>
      <div className="bento-left">
        <LiveTranscript meetingId={meetingId} />
        {insightsOn && <JargonExplainer items={jargonItems} />}
      </div>

      <div className="bento-right">
        {insightsOn && <LiveQuestions questions={questions} onToggle={handleToggleQuestion} />}
        <div className={insightsOn ? 'bento-right-bottom' : 'bento-right-only'}>
          {insightsOn && (
            <div className="bento-right-bottom-left">
              <AISuggestions suggestions={suggestions} />
            </div>
          )}
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
