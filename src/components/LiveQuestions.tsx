
import { HelpCircle } from 'lucide-react';

/* ─── Types ─── */
export interface QuestionItem {
  id: string;
  text: string;
  resolved: boolean;
}

interface LiveQuestionsProps {
  questions: QuestionItem[];
  onToggle: (id: string) => void;
}

/* ─── Component ─── */
export default function LiveQuestions({ questions, onToggle }: LiveQuestionsProps) {
  const visibleQuestions = questions.slice(0, 3);

  return (
    <div className="bento-panel bento-questions">
      <div className="bento-panel-header">
        <HelpCircle size={16} />
        <span>Live Questions</span>
        <span className="bento-badge">{visibleQuestions.filter((q) => !q.resolved).length} open</span>
      </div>

      <div className="bento-questions-list">
        {visibleQuestions.length === 0 ? (
          <p className="bento-empty-hint">
            AI-detected questions will appear here as the meeting progresses.
          </p>
        ) : (
          visibleQuestions.map((q) => (
            <label key={q.id} className={`question-item ${q.resolved ? 'question-resolved' : ''}`}>
              <input
                type="checkbox"
                checked={q.resolved}
                onChange={() => onToggle(q.id)}
                className="question-checkbox"
              />
              <span className="question-text" title={q.text}>{q.text}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
