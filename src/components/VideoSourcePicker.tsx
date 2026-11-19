import { useEffect, useState } from 'react';

interface VideoSourcePickerProps {
  /** Detected meeting apps; the picker is only offered when there is one. */
  detectedApps: string[];
  value: string;
  onChange: (sourceId: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * What the screen video shows: the meeting window ('auto'), a whole screen, or
 * another window. Used on the start sheet and in the recording bar.
 */
export default function VideoSourcePicker({ detectedApps, value, onChange, disabled, className }: VideoSourcePickerProps) {
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);

  const load = () => {
    void window.electronAPI?.getDesktopSources()
      .then((list) => setSources(list.filter((source) => source.name && !/agentzero/i.test(source.name)).map(({ id, name }) => ({ id, name }))))
      .catch(() => setSources([]));
  };
  useEffect(load, []);

  const screens = sources.filter((source) => source.id.startsWith('screen:'));
  const windows = sources.filter((source) => source.id.startsWith('window:'));
  const known = value === 'auto' || sources.some((source) => source.id === value);

  return (
    <select
      className={`setting-input capture-source-select ${className ?? ''}`}
      value={value}
      disabled={disabled}
      onFocus={load}
      onChange={(e) => onChange(e.target.value)}
      aria-label="What the screen video shows"
    >
      <option value="auto">Meeting window ({detectedApps[0]})</option>
      {screens.map((source, index) => (
        <option key={source.id} value={source.id}>{screens.length > 1 ? `Screen ${index + 1}` : 'Whole screen'}</option>
      ))}
      {windows.length > 0 && (
        <optgroup label="Another window">
          {windows.map((source) => <option key={source.id} value={source.id}>{source.name.length > 60 ? `${source.name.slice(0, 57)}…` : source.name}</option>)}
        </optgroup>
      )}
      {!known && <option value={value}>Current selection</option>}
    </select>
  );
}
