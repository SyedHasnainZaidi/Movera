import { useThemeStore } from '../stores/themeStore';

/**
 * The light/dark control.
 *
 * One button rather than a three-way switch. "Follow the system" is the
 * default and stays the default until someone overrides it, so it does not
 * need a position on the control - and a single button that cycles through
 * three states is a control nobody can predict.
 *
 * The icon shows what pressing it will DO, not what is currently on: a moon
 * while the page is light, because the moon is where the button goes. That is
 * also what the accessible name says, so the label and the picture agree.
 *
 * The two icons are crossfaded and rotated through each other rather than
 * swapped. Swapping is a state report; the turn is the answer to the press,
 * and it lands at the same moment the palette does.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useThemeStore((state) => state.theme);
  const toggle = useThemeStore((state) => state.toggle);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      /*
        Deliberately NOT `relative` here.

        The icon stack is positioned against the inner span, which carries its
        own `relative`. A second one on the button would be redundant - and
        worse, it would beat any `absolute` a caller passes in `className`,
        because utilities in the same group are resolved by their order in the
        stylesheet rather than in the attribute. That is exactly what dropped
        this control into the middle of the sign-in form.
      */
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-panel text-ink-600 transition-colors duration-[140ms] hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200 ${className}`}
    >
      <span className="relative block h-[18px] w-[18px]">
        <SunIcon
          className={`absolute inset-0 transition-[opacity,transform] duration-[320ms] ease-[cubic-bezier(0.16,0.84,0.44,1)] ${
            isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
          }`}
        />
        <MoonIcon
          className={`absolute inset-0 transition-[opacity,transform] duration-[320ms] ease-[cubic-bezier(0.16,0.84,0.44,1)] ${
            isDark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
          }`}
        />
      </span>
    </button>
  );
}

function SunIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="10" cy="10" r="3.6" />
      <path d="M10 1.6v2M10 16.4v2M18.4 10h-2M3.6 10h-2M15.9 4.1l-1.4 1.4M5.5 14.5l-1.4 1.4M15.9 15.9l-1.4-1.4M5.5 5.5 4.1 4.1" />
    </svg>
  );
}

function MoonIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z" />
    </svg>
  );
}
