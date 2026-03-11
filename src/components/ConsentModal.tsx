import { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';

interface ConsentModalProps {
  detectedApps: string[];
  onAccept: () => void;
  onCancel: () => void;
}

export default function ConsentModal({ detectedApps, onAccept, onCancel }: ConsentModalProps) {
  const [countdown, setCountdown] = useState(5);
  const canAccept = countdown <= 0;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-icon-wrap">
          <ShieldAlert size={32} />
        </div>

        <h3 className="modal-title">Recording Consent Required</h3>

        {detectedApps.length > 0 && (
          <div className="modal-detected">
            <span className="modal-detected-label">Detected:</span>
            {detectedApps.map((app) => (
              <span key={app} className="modal-detected-tag">{app}</span>
            ))}
          </div>
        )}

        <p className="modal-text">
          Before recording I have taken full consent of all attendees of the meeting to record it for my personal use.
        </p>

        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`modal-btn modal-btn-accept ${!canAccept ? 'modal-btn-disabled' : ''}`}
            onClick={canAccept ? onAccept : undefined}
            disabled={!canAccept}
          >
            {canAccept ? 'OK — Start Recording' : `Wait ${countdown}s...`}
          </button>
        </div>
      </div>
    </div>
  );
}
