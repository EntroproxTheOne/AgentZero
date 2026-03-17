import { useEffect, useRef } from 'react';
import { BookOpen } from 'lucide-react';

/* ─── Types ─── */
export interface JargonItem {
  id: string;
  term: string;
  explanation: string;
}

interface JargonExplainerProps {
  items: JargonItem[];
}

/* ─── Component ─── */
export default function JargonExplainer({ items }: JargonExplainerProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (items.length === 0 || !listRef.current) return;
    listRef.current.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, [items]);

  return (
    <div className="bento-panel bento-jargon">
      <div className="bento-panel-header">
        <BookOpen size={16} />
        <span>Jargon / Explanations</span>
      </div>

      <div ref={listRef} className="bento-jargon-list">
        {items.length === 0 ? (
          <p className="bento-empty-hint">
            Technical terms and jargon will be explained here in real time.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="jargon-entry">
              <span className="jargon-term">{item.term}</span>
              <p className="jargon-explanation">{item.explanation}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
