import { Link } from 'react-router-dom';

/**
 * Movera brand mark: a goniometer.
 *
 * The goniometer is the hinged, degree-marked protractor a physiotherapist
 * holds against a joint to measure its range - the single most recognisable
 * object in the profession, and the thing this product replaces with a camera.
 * The mark is that instrument reduced to its parts: a pivot, a fixed arm, a
 * moving arm, and the arc between them.
 *
 * It replaces a letter M inside a teal circle, which said nothing about
 * physiotherapy and would have been the same mark for any company beginning
 * with M.
 *
 * Drawn in CSS and SVG rather than shipped as an image, so it stays crisp at
 * every size, recolours for the dark session console without a second asset,
 * and adds nothing to load.
 */

const SIZES = {
  sm: { tile: 'h-8 w-8', glyph: 20 },
  md: { tile: 'h-9 w-9', glyph: 22 },
  lg: { tile: 'h-12 w-12', glyph: 30 },
} as const;

function GoniometerGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* the arc between the arms - the measurement itself */}
      <path d="M15 18 A 9 9 0 0 0 11.4 10.8" className="opacity-55" />
      {/* fixed arm */}
      <path d="M6 18 H 19" />
      {/* moving arm, articulated on hover by .mark-arm in index.css */}
      <path d="M6 18 L 15.2 7.4" className="mark-arm" />
      {/* pivot */}
      <circle cx="6" cy="18" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MoveraMark({
  size = 'md',
  tone = 'brand',
}: {
  size?: keyof typeof SIZES;
  tone?: 'brand' | 'light';
}) {
  const { tile, glyph } = SIZES[size];

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-panel ${tile} ${
        tone === 'light'
          ? 'bg-white/10 text-brand-300 ring-1 ring-inset ring-white/15'
          : 'bg-brand-600 text-white ring-1 ring-inset ring-brand-800/25'
      }`}
    >
      <GoniometerGlyph size={glyph} />
    </span>
  );
}

/**
 * The brand button in the navigation bar.
 *
 * Links to `/`, which the router resolves to whichever dashboard the signed-in
 * user belongs to - so "home" means the right home for a patient and for a
 * therapist without a second route or a duplicated landing page.
 */
export function MoveraBrand({
  showWordmark = true,
  tone = 'brand',
}: {
  showWordmark?: boolean;
  tone?: 'brand' | 'light';
}) {
  return (
    <Link
      to="/"
      // An accessible name is supplied here because the mark itself is
      // aria-hidden decoration.
      aria-label="Movera home"
      className="brand-link flex items-center gap-2.5 rounded-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <MoveraMark tone={tone} />
      {showWordmark && (
        <span
          className={`type-display text-[17px] ${
            tone === 'light' ? 'text-white' : 'text-ink-900'
          }`}
        >
          Movera
        </span>
      )}
    </Link>
  );
}
