import { useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

interface TodoListProps {
  items: TodoItem[];
  onToggle: (id: number) => void;
  onAdd: (text: string) => void;
  recommendedText?: string | null;
}

export default function TodoList({
  items,
  onToggle,
  onAdd,
  recommendedText = null,
}: TodoListProps) {
  const [input, setInput] = useState('');
  const normalizedTodoTexts = new Set(items.map((item) => item.text.trim().toLowerCase()));
  const showRecommended = Boolean(
    recommendedText
    && !normalizedTodoTexts.has(recommendedText.trim().toLowerCase()),
  );

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInput('');
  };

  return (
    <div className="bento-panel bento-todo">
      <div className="bento-panel-header">
        <ListChecks size={16} />
        <span>To-Dos</span>
        <span className="bento-badge">{items.filter((item) => !item.done).length}</span>
      </div>

      <div className="bento-todo-list">
        {showRecommended && (
          <div className="todo-recommendation-inline">
            <span className="todo-recommendation-label">Suggested</span>
            <button
              type="button"
              className="todo-recommendation"
              onClick={() => onAdd(recommendedText!.trim())}
              title={recommendedText ?? ''}
            >
              <span className="todo-recommendation-text">{recommendedText}</span>
              <span className="todo-recommendation-plus">+</span>
            </button>
          </div>
        )}

        {items.map((item) => (
          <label key={item.id} className={`todo-item ${item.done ? 'todo-done' : ''}`}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => onToggle(item.id)}
              className="todo-checkbox"
            />
            <span className="todo-text">{item.text}</span>
          </label>
        ))}
      </div>

      <div className="bento-todo-input">
        <input
          type="text"
          placeholder="Add a to-do..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleAdd();
            }
          }}
          className="todo-field"
        />
        <button className="todo-add-btn" onClick={handleAdd} disabled={!input.trim()}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
