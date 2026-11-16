import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import type { AppUser } from '../types/meeting';

interface LoginPageProps {
  onLogin: (user: AppUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Set after a successful sign-in that requires choosing a new password.
  const [pendingUser, setPendingUser] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await window.electronAPI.login({ email, password });
      if (!result.success) {
        setError(result.error);
      } else if (result.user.mustChangePassword) {
        setPendingUser(result.user);
      } else {
        onLogin(result.user);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingUser) return;
    setError('');
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    if (newPassword === password) {
      setError('Choose a password different from the one you signed in with.');
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.updateUser({ userId: pendingUser.id, password: newPassword });
      if (!result.success) {
        setError(result.error);
      } else {
        onLogin(result.user);
      }
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
          <p className="login-subtitle">
            {pendingUser ? 'Choose a new password to finish signing in' : 'AI-powered meeting assistant'}
          </p>
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {!pendingUser ? (
          <form onSubmit={handleLogin} className="login-form">
            <div className="login-field">
              <Mail size={16} className="login-field-icon" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="login-field">
              <Lock size={16} className="login-field-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
                autoComplete="current-password"
                required
              />
              <button type="button" className="login-eye" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <div className="recorder-spinner" /> : <><ArrowRight size={16} /> Sign In</>}
            </button>
            <p className="login-hint">Forgot your password? Ask an admin to reset it in Settings → Accounts.</p>
          </form>
        ) : (
          <form onSubmit={handleSetPassword} className="login-form">
            <div className="login-field">
              <Lock size={16} className="login-field-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="New password (min 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="login-input"
                autoComplete="new-password"
                autoFocus
                required
              />
              <button type="button" className="login-eye" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="login-field">
              <Lock size={16} className="login-field-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="login-input"
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <div className="recorder-spinner" /> : <><ArrowRight size={16} /> Save and continue</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
