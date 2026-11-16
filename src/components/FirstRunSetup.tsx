import { useState } from 'react';
import { Mail, Lock, User, ArrowRight } from 'lucide-react';
import type { AppUser } from '../types/meeting';

interface FirstRunSetupProps {
  onComplete: (user: AppUser) => void;
}

/** Shown only while no account exists: the installer creates the admin account. */
export default function FirstRunSetup({ onComplete }: FirstRunSetupProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.firstRunSetup({ username, email, password });
      if (result.success) onComplete(result.user);
      else setError(result.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <h1 className="login-logo">Agent<span className="login-logo-accent">Zero</span></h1>
          <p className="login-subtitle">Welcome. Create the admin account for this computer.</p>
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <User size={16} className="login-field-icon" />
            <input className="login-input" placeholder="Your name" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div className="login-field">
            <Mail size={16} className="login-field-icon" />
            <input className="login-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </div>
          <div className="login-field">
            <Lock size={16} className="login-field-icon" />
            <input className="login-input" type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </div>
          <div className="login-field">
            <Lock size={16} className="login-field-icon" />
            <input className="login-input" type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? <div className="recorder-spinner" /> : <><ArrowRight size={16} /> Create admin account</>}
          </button>
          <p className="login-hint">This account can add other people and give them admin access later, in Settings.</p>
        </form>
      </div>
    </div>
  );
}
