import { Minus, Square, X } from 'lucide-react';

export default function TitleBar() {
  const handleMinimize = () => window.electronAPI?.windowMinimize();
  const handleMaximize = () => window.electronAPI?.windowMaximize();
  const handleClose = () => window.electronAPI?.windowClose();

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <span className="title-bar-logo">Agent<span className="title-bar-accent">Zero</span></span>
      </div>
      <div className="title-bar-controls">
        <button
          className="title-btn title-btn-minimize"
          onClick={handleMinimize}
          aria-label="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          className="title-btn title-btn-maximize"
          onClick={handleMaximize}
          aria-label="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          className="title-btn title-btn-close"
          onClick={handleClose}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
