import { useState } from 'react';
import { User, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';

interface LoginPageProps {
  onLogin: (user: { id: number; username: string; email: string; listener_name: string }) => void;
}

type View = 'login' | 'register' | 'forgot';

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [view, setView] = useState<View>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Form fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await window.electronAPI.login({ email, password });
      if (result.success && result.user) {
        onLogin(result.user);
      } else {
        setError(result.error || 'Login failed');
      }
    } catch {
      setError('An error occurred');
    }
    setLoading(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.register({ username, email, password });
      if (result.success) {
        setSuccess('Account created! You can now log in.');
        setView('login');
        setPassword('');
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch {
      setError('An error occurred');
    }
    setLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.resetPassword({ email, newPassword });
      if (result.success) {
        setSuccess('Password reset! You can now log in.');
        setView('login');
        setNewPassword('');
      } else {
        setError(result.error || 'Reset failed');
      }
    } catch {
      setError('An error occurred');
    }
    setLoading(false);
  };

  const switchView = (v: View) => {
    setView(v);
    setError('');
    setSuccess('');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <h1 className="login-logo">Agent<span className="login-logo-accent">Zero</span></h1>
          <p className="login-subtitle">AI-powered meeting assistant</p>
        </div>

        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success">{success}</div>}

        {view === 'login' && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="login-field">
              <Mail size={16} className="login-field-icon" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
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
                required
              />
              <button type="button" className="login-eye" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <div className="recorder-spinner" /> : <><ArrowRight size={16} /> Sign In</>}
            </button>
            <div className="login-links">
              <button type="button" className="login-link" onClick={() => switchView('forgot')}>Forgot password?</button>
              <button type="button" className="login-link" onClick={() => switchView('register')}>Create account</button>
            </div>
          </form>
        )}

        {view === 'login' && (
          <>
            <div className="login-divider"><span>or</span></div>
            <button
              className="login-guest"
              onClick={() => onLogin({ id: 0, username: 'Guest', email: '', listener_name: 'Guest' })}
            >
              Continue without account
            </button>
          </>
        )}

        {view === 'register' && (
          <form onSubmit={handleRegister} className="login-form">
            <div className="login-field">
              <User size={16} className="login-field-icon" />
              <input
                type="text"
                placeholder="Username (also used as listener name)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="login-input"
                required
              />
            </div>
            <div className="login-field">
              <Mail size={16} className="login-field-icon" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
                required
              />
            </div>
            <div className="login-field">
              <Lock size={16} className="login-field-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password (min 6 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
                required
              />
              <button type="button" className="login-eye" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <div className="recorder-spinner" /> : <><ArrowRight size={16} /> Create Account</>}
            </button>
            <div className="login-links">
              <button type="button" className="login-link" onClick={() => switchView('login')}>Already have an account? Sign in</button>
            </div>
          </form>
        )}

        {view === 'forgot' && (
          <form onSubmit={handleResetPassword} className="login-form">
            <div className="login-field">
              <Mail size={16} className="login-field-icon" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
                required
              />
            </div>
            <div className="login-field">
              <Lock size={16} className="login-field-icon" />
              <input
                type="password"
                placeholder="New Password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="login-input"
                required
              />
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <div className="recorder-spinner" /> : <><ArrowRight size={16} /> Reset Password</>}
            </button>
            <div className="login-links">
              <button type="button" className="login-link" onClick={() => switchView('login')}>Back to sign in</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
