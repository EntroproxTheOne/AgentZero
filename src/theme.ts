// Appearance: light (default), dark, or follow the operating system. Stored per device.
export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'agentzero.theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage unavailable: use the default.
  }
  return 'light';
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && Boolean(media?.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not persisted, but still applied for this session.
  }
  apply(choice);
}

/** Call once at startup. */
export function initTheme() {
  apply(getThemeChoice());
  media?.addEventListener('change', () => {
    if (getThemeChoice() === 'system') apply('system');
  });
}
