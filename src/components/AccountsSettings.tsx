import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserCog, Users, Trash2, KeyRound, Plus } from 'lucide-react';
import type { AppUser } from '../types/meeting';

interface AccountsSettingsProps {
  user: AppUser;
  onUserUpdated: (user: AppUser) => void;
  onSignedOut: () => void;
}

type Message = { kind: 'ok' | 'error'; text: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <span className={message.kind === 'ok' ? 'settings-provider-saved' : 'settings-error-text'} role={message.kind === 'error' ? 'alert' : undefined}>
      {message.text}
    </span>
  );
}

export default function AccountsSettings({ user, onUserUpdated, onSignedOut }: AccountsSettingsProps) {
  // ── My account ──
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [selfMessage, setSelfMessage] = useState<Message>(null);

  // ── All accounts (admin) ──
  const [users, setUsers] = useState<AppUser[]>([]);
  const [adminMessage, setAdminMessage] = useState<Message>(null);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', isAdmin: false });
  // Inline password reset (window.prompt is disabled in Electron).
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetValue, setResetValue] = useState('');

  const loadUsers = useCallback(async () => {
    if (!user.isAdmin) return;
    const result = await window.electronAPI.listUsers();
    if (result.success) setUsers(result.users);
    else setAdminMessage({ kind: 'error', text: result.error });
  }, [user.isAdmin]);

  useEffect(() => {
    if (!user.isAdmin) return;
    let active = true;
    void window.electronAPI.listUsers().then((result) => {
      if (!active) return;
      if (result.success) setUsers(result.users);
      else setAdminMessage({ kind: 'error', text: result.error });
    });
    return () => { active = false; };
  }, [user.isAdmin]);

  const saveSelf = async () => {
    setSelfMessage(null);
    const changes: { userId: number; username?: string; email?: string; password?: string; currentPassword?: string } = { userId: user.id };
    if (username.trim() && username.trim() !== user.username) changes.username = username.trim();
    if (email.trim() && email.trim().toLowerCase() !== user.email) changes.email = email.trim();
    if (newPassword) {
      changes.password = newPassword;
      changes.currentPassword = currentPassword;
    }
    const result = await window.electronAPI.updateUser(changes);
    if (!result.success) {
      setSelfMessage({ kind: 'error', text: result.error });
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    onUserUpdated(result.user);
    setSelfMessage({ kind: 'ok', text: 'Saved.' });
    void loadUsers();
  };

  const deleteSelf = async () => {
    if (!window.confirm('Delete your account? This cannot be undone. Your recorded meetings stay on this computer.')) return;
    const result = await window.electronAPI.deleteUser({ userId: user.id });
    if (!result.success) {
      setSelfMessage({ kind: 'error', text: result.error });
      return;
    }
    onSignedOut();
  };

  const createAccount = async () => {
    setAdminMessage(null);
    const result = await window.electronAPI.createUser(newUser);
    if (!result.success) {
      setAdminMessage({ kind: 'error', text: result.error });
      return;
    }
    setNewUser({ username: '', email: '', password: '', isAdmin: false });
    setAdminMessage({ kind: 'ok', text: `Created ${result.user.email}. They choose their own password on first sign-in.` });
    void loadUsers();
  };

  const setAdmin = async (target: AppUser, isAdmin: boolean) => {
    setAdminMessage(null);
    const result = await window.electronAPI.updateUser({ userId: target.id, isAdmin });
    if (!result.success) setAdminMessage({ kind: 'error', text: result.error });
    else {
      if (target.id === user.id) onUserUpdated(result.user);
      void loadUsers();
    }
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    const result = await window.electronAPI.updateUser({ userId: resetTarget.id, password: resetValue });
    if (result.success) {
      setAdminMessage({ kind: 'ok', text: `Password reset for ${resetTarget.email}. They will choose a new one at next sign-in.` });
      setResetTarget(null);
      setResetValue('');
    } else {
      setAdminMessage({ kind: 'error', text: result.error });
    }
  };

  const removeAccount = async (target: AppUser) => {
    if (!window.confirm(`Delete the account ${target.email}? This cannot be undone.`)) return;
    const result = await window.electronAPI.deleteUser({ userId: target.id });
    if (!result.success) setAdminMessage({ kind: 'error', text: result.error });
    else void loadUsers();
  };

  return (
    <>
      <div className="settings-card">
        <div className="settings-card-header">
          <UserCog size={18} className="settings-card-icon" />
          <h4 className="settings-card-title">My Account</h4>
          {user.isAdmin && <span className="settings-beta-badge">Admin</span>}
        </div>
        <div className="settings-card-body">
          <div className="settings-pair">
            <div className="setting-row">
              <label className="setting-label" htmlFor="acct-username">Username</label>
              <input id="acct-username" className="setting-input" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="setting-row">
              <label className="setting-label" htmlFor="acct-email">Email</label>
              <input id="acct-email" type="email" className="setting-input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="setting-row">
            <label className="setting-label" htmlFor="acct-current">Change password</label>
            <div className="settings-pair">
              <input id="acct-current" type="password" className="setting-input" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
              <input type="password" className="setting-input" placeholder="New password (min 8 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" aria-label="New password" />
            </div>
          </div>
          <div className="settings-actions-row">
            <button className="setting-save-btn" onClick={() => void saveSelf()}>Save account</button>
            <button className="setting-danger-btn" onClick={() => void deleteSelf()}><Trash2 size={14} /> Delete my account</button>
            <Feedback message={selfMessage} />
          </div>
        </div>
      </div>

      {user.isAdmin && (
        <div className="settings-card settings-card-wide">
          <div className="settings-card-header">
            <Users size={18} className="settings-card-icon" />
            <h4 className="settings-card-title">Accounts</h4>
            <span className="settings-provider-meta">{users.length} total</span>
          </div>
          <div className="settings-card-body">
            <div className="accounts-table" role="table" aria-label="Accounts">
              {users.map((account) => (
                <div className="accounts-row" role="row" key={account.id}>
                  <div className="accounts-who" role="cell">
                    <span className="accounts-name">{account.username}{account.id === user.id ? ' (you)' : ''}</span>
                    <span className="accounts-email">{account.email}</span>
                  </div>
                  <label className="accounts-admin" role="cell">
                    <input type="checkbox" checked={account.isAdmin} onChange={(e) => void setAdmin(account, e.target.checked)} />
                    <ShieldCheck size={14} /> Admin
                  </label>
                  <div className="accounts-actions" role="cell">
                    {account.id !== user.id && (
                      <button className="setting-link-btn" onClick={() => { setResetTarget(account); setResetValue(''); }}><KeyRound size={14} /> Reset password</button>
                    )}
                    {account.id !== user.id && (
                      <button className="setting-link-btn setting-link-danger" onClick={() => void removeAccount(account)}><Trash2 size={14} /> Delete</button>
                    )}
                  </div>
                  {resetTarget?.id === account.id && (
                    <form
                      className="accounts-reset"
                      onSubmit={(e) => { e.preventDefault(); void resetPassword(); }}
                    >
                      <input
                        className="setting-input"
                        type="password"
                        placeholder="Temporary password (min 8 characters)"
                        value={resetValue}
                        onChange={(e) => setResetValue(e.target.value)}
                        autoComplete="new-password"
                        autoFocus
                        aria-label={`Temporary password for ${account.email}`}
                      />
                      <button type="submit" className="setting-save-btn" disabled={resetValue.length < 8}>Set password</button>
                      <button type="button" className="setting-link-btn" onClick={() => setResetTarget(null)}>Cancel</button>
                    </form>
                  )}
                </div>
              ))}
            </div>

            <div className="setting-row">
              <label className="setting-label">Add an account</label>
              <div className="accounts-new">
                <input className="setting-input" placeholder="Name" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
                <input className="setting-input" type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
                <input className="setting-input" type="password" placeholder="Temporary password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} autoComplete="new-password" />
                <label className="accounts-admin">
                  <input type="checkbox" checked={newUser.isAdmin} onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })} /> Admin
                </label>
                <button className="setting-save-btn" onClick={() => void createAccount()}><Plus size={14} /> Create</button>
              </div>
            </div>
            <Feedback message={adminMessage} />
          </div>
        </div>
      )}
    </>
  );
}
