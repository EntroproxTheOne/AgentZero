
import { HelpCircle } from 'lucide-react';

/* ─── Types ─── */
export interface QuestionItem {
  id: number;
  text: string;
  resolved: boolean;
}

interface LiveQuestionsProps {
  questions: QuestionItem[];
  onToggle: (id: number) => void;
}

/* ─── Component ─── */
export default function LiveQuestions({ questions, onToggle }: LiveQuestionsProps) {
  return (
    <div className="bento-panel bento-questions">
      <div className="bento-panel-header">
        <HelpCircle size={16} />
        <span>Live Questions</span>
        <span className="bento-badge">{questions.filter((q) => !q.resolved).length} open</span>
      </div>

      <div className="bento-questions-list">
        {questions.length === 0 ? (
          <p className="bento-empty-hint">
            AI-detected questions will appear here as the meeting progresses.
          </p>
        ) : (
          questions.map((q) => (
            <label key={q.id} className={`question-item ${q.resolved ? 'question-resolved' : ''}`}>
              <input
                type="checkbox"
                checked={q.resolved}
                onChange={() => onToggle(q.id)}
                className="question-checkbox"
              />
              <span className="question-text">{q.text}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
