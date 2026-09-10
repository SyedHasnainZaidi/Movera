import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'movera.theme';

/**
 * Light and dark, and the difference between choosing and not choosing.
 *
 * Three states matter, not two:
 *
 *   - the reader picked light
 *   - the reader picked dark
 *   - the reader has not picked, so the machine decides
 *
 * The third is the default and it stays live: someone whose laptop switches to
 * dark at sunset gets a dark application at sunset, until the first time they
 * override it. Collapsing that into a stored boolean at first load would
 * silently freeze whatever the machine happened to be set to when they first
 * visited.
 *
 * The DOM is the source of truth for what is currently displayed, because a
 * script in index.html sets the attribute before React exists - see the note
 * there for why that has to happen before the first paint.
 */
interface ThemeState {
  theme: Theme;
  /** False while the machine's setting is still being followed. */
  chosen: boolean;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  /** Starts following the OS again, forgetting an earlier choice. */
  useSystem: () => void;
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Private browsing and blocked storage both throw. Neither is a reason to
    // fail to render, so the machine's setting is used instead.
    return null;
  }
}

function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;

  // Keeps the browser's own chrome - the address bar on a phone, the window
  // frame - from staying light behind a dark page.
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#0d1413' : '#f5f8f7');
}

const initialChoice = storedTheme();

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialChoice ?? systemTheme(),
  chosen: initialChoice !== null,

  setTheme: (theme) => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The theme still applies for this session; it just will not be
      // remembered. Not worth telling anyone about.
    }
    set({ theme, chosen: true });
  },

  toggle: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* see setTheme */
      }
      return { theme: next, chosen: true };
    }),

  useSystem: () => {
    const next = systemTheme();
    apply(next);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* see setTheme */
    }
    set({ theme: next, chosen: false });
  },
}));

/**
 * Keeps an un-chosen theme in step with the operating system.
 *
 * Called once from App. Does nothing once the reader has expressed a
 * preference, which is the whole point: an explicit choice must not be undone
 * by the machine changing its mind later.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};

  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (useThemeStore.getState().chosen) return;
    const next: Theme = query.matches ? 'dark' : 'light';
    apply(next);
    useThemeStore.setState({ theme: next });
  };

  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
}

/** Applied once on boot, in case the index.html script did not run. */
export function syncThemeToDocument(): void {
  apply(useThemeStore.getState().theme);
}
