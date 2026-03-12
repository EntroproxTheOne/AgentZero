import { useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';

/* ─── Types ─── */
export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

interface TodoListProps {
  items: TodoItem[];
  onToggle: (id: number) => void;
  onAdd: (text: string) => void;
}

/* ─── Component ─── */
export default function TodoList({ items, onToggle, onAdd }: TodoListProps) {
  const [input, setInput] = useState('');

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
        <span className="bento-badge">{items.filter((t) => !t.done).length}</span>
      </div>

      <div className="bento-todo-list">
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
          placeholder="Add a to-do…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="todo-field"
        />
        <button className="todo-add-btn" onClick={handleAdd} disabled={!input.trim()}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
