import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CountUp, useInView, useRipple } from '../motion';

/**
 * Shared interface primitives.
 *
 * Every page in the application is built from these, so the design decisions
 * that matter are made once, here:
 *
 *   - Labels are sentence case. The tracked-out capitals this file used to
 *     carry are hard to read at small sizes, and they were applied to every
 *     panel regardless of importance, which meant they ranked nothing.
 *   - Radius encodes level rather than taste: `readout` inside `panel` inside
 *     `card` inside `stage`.
 *   - Motion answers an action. Buttons and rows respond to a pointer; nothing
 *     here animates on its own.
 *   - Status is never colour alone. Every tone ships with a word.
 */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'console' | 'light';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  /*
   * The filled colours come from the `accent-solid` tokens rather than from a
   * brand step, because the fill and the text on it move in opposite
   * directions when the theme flips - dark teal with white on light, pale teal
   * with near-black on dark. See the note in index.css.
   */
  primary:
    'bg-accent-solid text-on-accent shadow-panel hover:bg-accent-solid-hover active:bg-accent-solid-active disabled:bg-ink-300 disabled:text-ink-500 disabled:shadow-none',
  secondary:
    'bg-surface text-ink-800 border border-ink-200 hover:border-ink-300 hover:bg-sunken active:bg-ink-100 disabled:text-ink-400 disabled:border-ink-200',
  danger:
    'bg-problem-500 text-white shadow-panel hover:bg-problem-700 active:bg-problem-700 disabled:bg-ink-300 disabled:shadow-none',
  ghost:
    'text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200 disabled:text-ink-400',
  /** On a photographic or video ground, where a themed surface would vanish. */
  console:
    'bg-white/10 text-white ring-1 ring-inset ring-white/20 hover:bg-white/16 active:bg-white/22 disabled:text-white/40',
  /**
   * A primary action sitting ON the always-dark Today panel. Literally white,
   * not `surface`: that panel does not follow the theme, so neither can this.
   */
  light:
    'bg-white text-brand-800 shadow-panel hover:bg-brand-50 active:bg-brand-100 disabled:bg-white/40 disabled:text-brand-800/50',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-[15px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * Two responses to being used, because the two input methods need different
 * ones.
 *
 * With a pointer, the button drops a pixel on `:active` - the cheapest
 * possible confirmation, and it arrives long before any network response
 * could. With a finger there is no hover and no cursor, so a mark grows from
 * the point of contact instead: on a touchscreen that is the only way to tell
 * a tap that landed on the control from one that landed beside it.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  onPointerDown,
  ...rest
}: ButtonProps) {
  const ripple = useRipple<HTMLButtonElement>();

  return (
    <button
      {...rest}
      onPointerDown={(event) => {
        if (!disabled && !loading) ripple(event);
        onPointerDown?.(event);
      }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      // `relative` and `overflow-hidden` exist for the press mark, which is
      // positioned inside the button and has to be clipped to its shape.
      className={`relative isolate inline-flex items-center justify-center gap-2 overflow-hidden rounded-panel font-medium transition-[background-color,border-color,box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.16,0.84,0.44,1)] active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

/**
 * The mark on a row that can be opened.
 *
 * Pairs with `.row-interactive` in the stylesheet, which is what makes it
 * move. Decorative: the row's own text is its accessible name.
 */
export function RowArrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="row-arrow shrink-0"
    >
      <path d="M6 3.5 L 10.5 8 L 6 12.5" />
    </svg>
  );
}

/**
 * A block of content on a light page.
 *
 * Cards arrive as they are scrolled to, by default and without the page having
 * to ask. Putting the behaviour here rather than in a wrapper at every call
 * site means one rule governs it: a section becomes visible when the reader
 * reaches it, once, and then stays visible however much they scroll back.
 *
 * Pass `reveal={false}` for a card that is already inside something which
 * animates, so the two entrances do not compound into one long slide.
 */
export function Card({
  children,
  className = '',
  interactive = false,
  reveal = true,
  revealIndex = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Set only when the whole card is itself one action. */
  interactive?: boolean;
  reveal?: boolean;
  /** Position in a stagger, when several cards come into view together. */
  revealIndex?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={reveal ? ref : undefined}
      data-reveal={reveal ? (inView ? 'shown' : 'hidden') : undefined}
      style={
        reveal
          ? { ['--reveal-index' as string]: Math.min(revealIndex, 8) }
          : undefined
      }
      className={`rounded-card border border-ink-200 bg-surface shadow-panel ${
        interactive ? 'lift hover:border-ink-300' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
      <div>
        <h2 className="type-display text-[15px] text-ink-900">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-ink-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Page title.
 *
 * One treatment for every screen, so the eye finds the same thing in the same
 * place after every navigation. The heading is set in the display width, which
 * is the only place in the interface where the narrow axis appears - that is
 * what makes it read as a title rather than as large body text.
 */
export function PageHeader({
  title,
  description,
  action,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 ${className}`}
    >
      <div className="min-w-0">
        <h1 className="type-display text-[26px] leading-tight text-ink-900">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-ink-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Status pill.
 *
 * Always renders a text label alongside the colour, never colour alone -
 * required so the correct/incorrect distinction is readable with any form of
 * colour-vision deficiency.
 */
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'caution' | 'problem' | 'brand' | 'console';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
    good: 'bg-good-50 text-good-700 ring-good-500/30',
    caution: 'bg-caution-50 text-caution-700 ring-caution-500/30',
    problem: 'bg-problem-50 text-problem-700 ring-problem-500/30',
    brand: 'bg-brand-50 text-brand-700 ring-brand-500/30',
    console: 'bg-white/10 text-stage-100 ring-white/20',
  } as const;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export interface StatItem {
  label: string;
  value: ReactNode;
  hint?: string;
  /** 0 to 1. Draws a rule under the figure showing it against its ceiling. */
  meter?: number;
  tone?: 'brand' | 'good' | 'caution' | 'problem';
  /**
   * Counts up to this number the first time the figure is scrolled into view,
   * replacing `value`.
   *
   * Only for totals that genuinely ACCUMULATED - sessions attended,
   * repetitions performed. Counting up is a small animated argument that
   * something added up over time, and that argument is false for a score, a
   * target or a ratio, so those are printed outright.
   */
  countTo?: number;
  /** How to render the counting value. Defaults to a whole number. */
  format?: (value: number) => string;
}

const METER_TONES = {
  brand: 'bg-brand-500',
  good: 'bg-good-500',
  caution: 'bg-caution-500',
  problem: 'bg-problem-500',
} as const;

function StatBody({
  label,
  value,
  hint,
  meter,
  tone = 'brand',
  countTo,
  format,
}: StatItem) {
  return (
    <>
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className="type-display type-measure mt-1.5 text-[28px] leading-none text-ink-900">
        {countTo !== undefined ? (
          <CountUp to={countTo} format={format} />
        ) : (
          value
        )}
      </p>
      {meter !== undefined && (
        <div
          className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-ink-100"
          aria-hidden="true"
        >
          {/*
            Grows from nothing on mount. The keyframe has no `to`, so it
            finishes at whatever width the inline style sets - which means the
            bar cannot animate to a value the data does not support, and under
            reduced motion it simply appears at the right width.
          */}
          <div
            className={`animate-meter-grow h-full origin-left rounded-full ${METER_TONES[tone]}`}
            style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-2 text-xs text-ink-500">{hint}</p>}
    </>
  );
}

/** A single figure, standing on its own. */
export function Stat(props: StatItem) {
  return (
    <div className="rounded-card border border-ink-200 bg-surface px-5 py-4 shadow-panel">
      <StatBody {...props} />
    </div>
  );
}

/**
 * Several figures that belong to one another.
 *
 * One panel divided by hairlines rather than four separate cards. Four
 * identical boxes in a row implies four unrelated things; a divided strip says
 * these are facets of the same reading, which is what a caseload summary or a
 * patient's totals actually are.
 */
export function StatStrip({
  items,
  className = '',
  reveal = true,
}: {
  items: StatItem[];
  className?: string;
  reveal?: boolean;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    /*
     * The dividers are the grid's own gaps letting the container colour
     * through, rather than borders on the cells. That way the hairlines land
     * correctly at every breakpoint - four across, two by two, or a single
     * column - without a rule per cell working out which edge it is on.
     */
    <div
      ref={reveal ? ref : undefined}
      data-reveal={reveal ? (inView ? 'shown' : 'hidden') : undefined}
      className={`grid gap-px overflow-hidden rounded-card border border-ink-200 bg-ink-200 shadow-panel sm:grid-cols-2 lg:grid-cols-4 ${className}`}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-surface px-5 py-4">
          <StatBody {...item} />
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing here yet.
 *
 * Written as an invitation rather than as a report of absence: an empty screen
 * is the moment a person most needs to be told what to do next, so every empty
 * state that has a sensible next step carries the control for it.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-ink-300 bg-surface px-6 py-12 text-center">
      <svg
        viewBox="0 0 48 30"
        width="48"
        height="30"
        fill="none"
        aria-hidden="true"
        className="mb-4 text-ink-300 dark:text-ink-400"
      >
        {/* An empty goniometer: the instrument with nothing to measure. */}
        <path
          d="M4 26 H 44"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M4 26 L 28 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="3 4"
        />
        <path
          d="M26 26 A 22 22 0 0 0 20.2 11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="opacity-60"
        />
        <circle cx="4" cy="26" r="2.5" fill="currentColor" />
      </svg>
      <h3 className="type-display text-sm text-ink-800">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="animate-cue-in rounded-card border border-problem-500/30 bg-problem-50 px-5 py-4"
    >
      <p className="text-sm font-medium text-problem-700">{message}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={onRetry}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Loading placeholder.
 *
 * A directional sweep rather than a pulse. Pulsing reads as something
 * retrying; a sweep reads as something arriving, which is what is happening.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`shimmer rounded-panel ${className}`}
      aria-hidden="true"
    />
  );
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // `field` lets the label react to focus landing anywhere inside - see the
    // `:focus-within` rule in index.css.
    <div className="field space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="field-label block text-sm font-medium text-ink-800"
      >
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink-500">{hint}</p>}
      {error && (
        <p
          className="animate-cue-in text-xs font-medium text-problem-700"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full rounded-panel border border-ink-300 bg-surface px-3 py-2 text-sm text-ink-900 transition-[border-color,box-shadow] duration-[140ms] placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:bg-ink-100';

/**
 * Repeated verbatim wherever an analysis threshold is shown. The wording is
 * fixed on purpose: nothing in this application may imply clinical validation.
 */
export function PrototypeDisclaimer({
  className = '',
  onDark = false,
}: {
  className?: string;
  /** The session console is dark; ink-500 is unreadable on it. */
  onDark?: boolean;
}) {
  return (
    <p
      className={`max-w-prose text-xs leading-relaxed ${
        onDark ? 'text-stage-400' : 'text-ink-500'
      } ${className}`}
    >
      Prototype analysis. Angle thresholds are demonstration defaults requiring
      physiotherapist validation. This system supports rehabilitation - it does
      not diagnose and is not a substitute for professional assessment.
    </p>
  );
}
