import { Sparkles } from 'lucide-react';

/* ─── Types ─── */
export interface SuggestionItem {
  id: string;
  text: string;
  type: 'action' | 'insight' | 'followup';
}

interface AISuggestionsProps {
  suggestions: SuggestionItem[];
}

/* ─── Component ─── */
export default function AISuggestions({ suggestions }: AISuggestionsProps) {
  const typeLabel: Record<SuggestionItem['type'], string> = {
    action: 'Action',
    insight: 'Insight',
    followup: 'Follow-up',
  };

  return (
    <div className="bento-panel bento-suggestions">
      <div className="bento-panel-header">
        <Sparkles size={16} />
        <span>AI Suggestions</span>
      </div>

      <div className="bento-suggestions-list">
        {suggestions.length === 0 ? (
          <p className="bento-empty-hint">
            AI suggestions will appear here as the conversation develops.
          </p>
        ) : (
          suggestions.map((s) => (
            <div key={s.id} className="suggestion-card">
              <span className={`suggestion-tag suggestion-tag-${s.type}`}>
                {typeLabel[s.type]}
              </span>
              <p className="suggestion-text">{s.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
