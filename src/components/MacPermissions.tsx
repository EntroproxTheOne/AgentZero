import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Mic, MonitorUp, RotateCw } from 'lucide-react';
import type { MacPermissionStatus } from '../types/meeting';

type Kind = 'microphone' | 'screen';

const LABELS: Record<Kind, { title: string; why: string; icon: typeof Mic }> = {
  microphone: { title: 'Microphone', why: 'Records your voice.', icon: Mic },
  screen: {
    title: 'Screen & System Audio Recording',
    why: 'Records the other people on a call (computer sound) and the screen video.',
    icon: MonitorUp,
  },
};

function isGranted(status: string | undefined) {
  return status === 'granted';
}

/**
 * macOS permissions. `banner` shows only when something is missing (and asks
 * macOS for the system pop-ups once per launch); `card` is the Settings view.
 */
export default function MacPermissions({ variant }: { variant: 'banner' | 'card' }) {
  const [status, setStatus] = useState<MacPermissionStatus | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const autoAsked = useRef(false);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.getMacPermissions) return null;
    const next = await window.electronAPI.getMacPermissions();
    setStatus(next);
    return next;
  }, []);

  const request = useCallback(async (kind: Kind) => {
    setBusy(kind);
    try {
      const result = await window.electronAPI.requestMacPermission(kind);
      if (kind === 'screen' && result.openedSettings) setNeedsRestart(true);
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const first = await refresh();
      // Banner only: ask macOS for its own pop-ups once per launch, for anything
      // never decided yet. (Denied permissions can only be changed in System Settings.)
      if (cancelled || variant !== 'banner' || !first?.isMac || autoAsked.current) return;
      autoAsked.current = true;
      if (first.microphone === 'not-determined') await request('microphone');
      if (!isGranted(first.screen)) await window.electronAPI.requestMacPermission('screen', { promptOnly: true });
      if (!cancelled) await refresh();
    })();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, request, variant]);

  if (!status?.isMac) return null;
  const missing = (['microphone', 'screen'] as Kind[]).filter((kind) => !isGranted(status[kind]));
  if (variant === 'banner' && missing.length === 0) return null;

  const rows = (variant === 'banner' ? missing : (['microphone', 'screen'] as Kind[])).map((kind) => {
    const { title, why, icon: Icon } = LABELS[kind];
    const granted = isGranted(status[kind]);
    return (
      <div className="macperm-row" key={kind}>
        <Icon size={16} />
        <span className="macperm-text">
          <strong>{title}</strong>
          <em>{why}</em>
        </span>
        {granted ? (
          <span className="macperm-ok"><CheckCircle2 size={14} /> Allowed</span>
        ) : (
          <button type="button" className="setting-save-btn macperm-btn" disabled={busy === kind} onClick={() => void request(kind)}>
            {busy === kind ? 'Waiting…' : status[kind] === 'not-determined' ? 'Allow' : 'Open System Settings'}
          </button>
        )}
      </div>
    );
  });

  const restartHint = (needsRestart || missing.includes('screen')) && (
    <div className="macperm-restart">
      <span>After switching AgentZero on in System Settings, restart the app so macOS applies it.</span>
      <button type="button" className="setting-link-btn" onClick={() => void window.electronAPI.relaunchApp()}>
        <RotateCw size={13} /> Restart AgentZero
      </button>
    </div>
  );

  if (variant === 'banner') {
    return (
      <div className="macperm-banner" role="alert">
        <div className="macperm-head">
          <AlertTriangle size={16} />
          <span>AgentZero needs {missing.length === 1 ? 'one more permission' : 'a couple of permissions'} on this Mac before it can record properly.</span>
        </div>
        {rows}
        {restartHint}
      </div>
    );
  }

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <MonitorUp size={18} className="settings-card-icon" />
        <h4 className="settings-card-title">Mac permissions</h4>
        <button type="button" className="setting-link-btn macperm-recheck" onClick={() => void refresh()}>
          <RotateCw size={13} /> Check again
        </button>
      </div>
      <div className="settings-card-body">
        {rows}
        {missing.length > 0 && restartHint}
      </div>
    </div>
  );
}
