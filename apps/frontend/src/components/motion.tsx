import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/**
 * Motion primitives.
 *
 * Two kinds of movement live here, and they are kept apart on purpose:
 *
 *   - Motion that ANSWERS the reader. A section arriving as it is scrolled to,
 *     a figure counting up when it comes into view, a control responding under
 *     a finger. All of it is a reaction to something a person just did.
 *   - Motion that reports a CHANGE in the data. A repetition landing, a cue
 *     being replaced. That lives next to the thing it describes.
 *
 * Nothing here loops for atmosphere.
 *
 * Everything degrades in two directions, because both happen in practice:
 *
 *   - `prefers-reduced-motion: reduce` is honoured in JavaScript as well as in
 *     CSS. The stylesheet collapses declarative animation on its own, but the
 *     helpers below decide whether to animate at all, so they have to ask.
 *   - Where the platform lacks an API - jsdom under test has neither
 *     `IntersectionObserver` nor `Element.animate` - the helper renders its
 *     FINAL state immediately. Motion is never load-bearing, and a page whose
 *     content only appears once an observer fires is a page that breaks.
 */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Whether motion should run at all in this environment.
 *
 * Resolved synchronously during the first render rather than in an effect, so
 * an element that is not going to animate is never painted in its hidden
 * starting state - which would otherwise flash content in and out on machines
 * where the observer is unavailable.
 */
function canAnimate(): boolean {
  return (
    typeof IntersectionObserver !== 'undefined' && !prefersReducedMotion()
  );
}

/** True when the reader has asked the system for less movement. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

/**
 * Fires once, the first time an element is scrolled into view.
 *
 * Deliberately one-way. An element that fades out again when it leaves the
 * viewport punishes someone for scrolling back to re-read something, and on a
 * dashboard that is exactly what people do.
 */
export function useInView<T extends Element>(options?: {
  /** Fraction of the element that must be visible. */
  amount?: number;
  /** Shrinks the viewport so a reveal starts slightly before the edge. */
  margin?: string;
}) {
  const [inView, setInView] = useState(() => !canAnimate());
  const ref = useRef<T | null>(null);

  const amount = options?.amount ?? 0.08;
  const margin = options?.margin ?? '0px 0px -8% 0px';

  useEffect(() => {
    if (!canAnimate()) {
      setInView(true);
      return undefined;
    }

    const element = ref.current;
    if (!element) return undefined;

    /*
     * Safety net.
     *
     * An element whose starting state is invisible is only ever shown again by
     * this observer, so if the observer never delivers, that content is gone -
     * silently, and only for some readers. An observer always reports on what
     * it is given shortly after `observe()`, intersecting or not, so a first
     * callback that never arrives means the mechanism is not working and the
     * content is shown outright.
     *
     * It has to be "did anything at all arrive", not a plain timeout: a timer
     * that shows everything after a second would reveal the whole page while
     * the reader is still at the top of it, and there would be nothing left
     * for scrolling to do.
     */
    let delivered = false;

    const observer = new IntersectionObserver(
      (entries) => {
        delivered = true;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: amount, rootMargin: margin },
    );

    observer.observe(element);

    const rescue = setTimeout(() => {
      if (!delivered) setInView(true);
    }, 1500);

    return () => {
      clearTimeout(rescue);
      observer.disconnect();
    };
  }, [amount, margin]);

  return { ref, inView };
}

/**
 * One item in a reveal sequence.
 *
 * `index` sets the position in a stagger rather than a delay in milliseconds,
 * so a page describes the ORDER things arrive in and the stylesheet owns the
 * timing. Changing the rhythm is then one edit in `index.css` instead of
 * thirty across the pages.
 *
 * The index is capped: a list of forty rows staggered at seventy milliseconds
 * apiece would take three seconds to finish arriving, and the reader would be
 * waiting on an animation to read their own data.
 */
export function Reveal({
  index = 0,
  as: Tag = 'div',
  className = '',
  style,
  children,
  ...rest
}: {
  index?: number;
  as?: ElementType;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
} & Record<string, unknown>) {
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <Tag
      {...rest}
      ref={ref}
      data-reveal={inView ? 'shown' : 'hidden'}
      className={className}
      style={{
        ['--reveal-index' as string]: Math.min(index, 8),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * One item in a MOUNT sequence, for screens that are not scrolled through.
 *
 * The sign-in form and the session console both fit the viewport, so there is
 * no scroll position for a reveal to answer - the thing that just happened is
 * that the screen opened. Uses the `.reveal` animation rather than the
 * `[data-reveal]` transition so it plays exactly once, on arrival.
 */
export function Rise({
  index = 0,
  as: Tag = 'div',
  className = '',
  style,
  children,
  ...rest
}: {
  index?: number;
  as?: ElementType;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Tag
      {...rest}
      className={`reveal ${className}`}
      style={{ ['--reveal-index' as string]: Math.min(index, 8), ...style }}
    >
      {children}
    </Tag>
  );
}

/**
 * A figure that counts up to its value the first time it is seen.
 *
 * Used only where the number is an ACCUMULATION - sessions completed,
 * repetitions performed, days of work - because counting up is a small
 * animated argument that something added up over time, and that argument is
 * false for a score or a target.
 *
 * It is never used on the live session console. A patient counting their own
 * repetitions has to be shown the true count on the frame it was produced;
 * rolling a safety-critical readout up from zero would be a lie in motion.
 */
export function CountUp({
  to,
  decimals = 0,
  format,
  duration = 1000,
  className = '',
}: {
  to: number;
  decimals?: number;
  format?: (value: number) => string;
  duration?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [value, setValue] = useState(() => (canAnimate() ? 0 : to));

  useEffect(() => {
    if (!inView || !canAnimate() || typeof requestAnimationFrame !== 'function') {
      setValue(to);
      return undefined;
    }

    let frame: number | null = null;
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration);
      // Decelerating: fast enough to feel immediate, slow enough at the end
      // that the final value is read rather than snapped past.
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setValue(to * eased);
      if (elapsed < 1) {
        frame = requestAnimationFrame(step);
      } else {
        // Always land on the exact value, never on the eased approximation.
        setValue(to);
      }
    };

    frame = requestAnimationFrame(step);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [inView, to, duration]);

  return (
    <span ref={ref} className={className}>
      {format ? format(value) : value.toFixed(decimals)}
    </span>
  );
}

/**
 * True once the page has been scrolled past `threshold` pixels.
 *
 * Drives the sticky header: at rest it is flush with the page, and once
 * content has moved underneath it, it separates itself with a hairline and a
 * shadow. The change is the answer to the scroll - it says the header is now
 * floating over something rather than sitting on it.
 */
export function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrolled;
}

/**
 * How far through the page the reader is, from 0 to 1.
 *
 * Read on a frame callback rather than on every scroll event, because a
 * touchscreen fires scroll far faster than the screen can redraw and there is
 * no reason to compute a ratio nobody will see.
 */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let frame: number | null = null;

    const measure = () => {
      frame = null;
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0);
    };

    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return progress;
}

/**
 * A pressure mark that grows from wherever the control was touched.
 *
 * On a touchscreen there is no hover and no cursor, so the only confirmation
 * that a tap landed on the button - rather than beside it - is the button
 * itself reacting at the point of contact. That matters most for a patient
 * propping a laptop or tablet across the room and reaching for Start.
 *
 * Written straight to the DOM rather than through state: a press must appear
 * on the same frame as the touch, and a re-render is a frame too late.
 */
export function useRipple<T extends HTMLElement>() {
  return useCallback((event: ReactPointerEvent<T>) => {
    const host = event.currentTarget;
    if (!host || prefersReducedMotion()) return;
    if (typeof host.animate !== 'function') return;

    const bounds = host.getBoundingClientRect();
    // Large enough to cover the control from any corner it was touched in.
    const size = Math.max(bounds.width, bounds.height) * 2.2;

    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.style.cssText = [
      'position:absolute',
      'border-radius:9999px',
      'pointer-events:none',
      'background:currentColor',
      'opacity:0.22',
      `width:${size}px`,
      `height:${size}px`,
      `left:${event.clientX - bounds.left - size / 2}px`,
      `top:${event.clientY - bounds.top - size / 2}px`,
    ].join(';');

    host.appendChild(mark);
    const animation = mark.animate(
      [
        { transform: 'scale(0)', opacity: 0.22 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      { duration: 520, easing: 'cubic-bezier(0.16, 0.84, 0.44, 1)' },
    );
    animation.onfinish = () => mark.remove();
    animation.oncancel = () => mark.remove();
  }, []);
}

/**
 * Replays a short emphasis animation whenever `trigger` changes.
 *
 * Implemented with the Web Animations API rather than by remounting the node
 * with a new `key`. The elements this is used on are ARIA live regions, and
 * removing a live region from the document to put an identical one back is a
 * reliable way to make a screen reader announce nothing at all - exactly the
 * announcement a patient counting repetitions needs most.
 *
 * The first render never animates: arriving at a screen is not a change.
 */
export function useEmphasis<T extends HTMLElement>(
  trigger: unknown,
  kind: 'land' | 'flash' = 'land',
) {
  const ref = useRef<T | null>(null);
  const seen = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!seen.current) {
      seen.current = true;
      return;
    }
    if (!element || prefersReducedMotion()) return;
    if (typeof element.animate !== 'function') return;

    if (kind === 'land') {
      element.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.13)', offset: 0.38 },
          { transform: 'scale(1)' },
        ],
        { duration: 460, easing: 'cubic-bezier(0.22, 1.4, 0.36, 1)' },
      );
    } else {
      element.animate(
        [
          { opacity: 0, transform: 'translateY(-4px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.16, 0.84, 0.44, 1)' },
      );
    }
  }, [trigger, kind]);

  return ref;
}

/**
 * Eases a live value towards its target for DISPLAY purposes only.
 *
 * The pose service emits ten frames a second and joint angles jitter by a
 * degree or two between them, which makes a large readout visibly buzz. This
 * smooths the movement of the dial without smoothing the number: callers show
 * the true value as text and give the eased value to the arc.
 *
 * Applied to a DIAL and never to the skeleton overlay. Easing a position
 * towards a target means never quite arriving at it, which is invisible on a
 * needle sweeping a scale and reads as lag on a figure traced over a moving
 * body - see the note in PoseOverlay.
 */
export function useEasedValue(target: number, factor = 0.18): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  displayRef.current = display;

  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setDisplay(target);
      return undefined;
    }

    let frame: number | null = null;

    const step = () => {
      const current = displayRef.current;
      const distance = target - current;

      // Stop scheduling once the gap is smaller than anything a reader could
      // see. Without this the loop would run forever chasing a fraction of a
      // degree, keeping a frame callback alive for the whole session.
      if (Math.abs(distance) < 0.15) {
        setDisplay(target);
        return;
      }

      setDisplay(current + distance * factor);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [target, factor]);

  return display;
}

/**
 * The length of an SVG path, measured once it is in the document.
 *
 * A self-drawing stroke needs `stroke-dasharray` set to the path's own length,
 * and that length is only knowable after layout. Callers pass the result to
 * the `--draw-length` custom property used by `.draw-in`.
 */
export function usePathLength() {
  const [length, setLength] = useState(0);

  const ref = useCallback((node: SVGPathElement | null) => {
    if (!node || typeof node.getTotalLength !== 'function') return;
    try {
      setLength(node.getTotalLength());
    } catch {
      // jsdom throws here; a zero length simply means no draw-in.
      setLength(0);
    }
  }, []);

  return { ref, length };
}

/**
 * Re-runs an entrance animation on every route change.
 *
 * Returns a key for the element wrapping the router outlet. Changing the key
 * remounts that subtree, which restarts its CSS animation - the one reliable
 * way to replay an entrance without tracking animation state by hand. It is
 * safe here precisely because a navigation is meant to throw the old page
 * away.
 */
export function usePageTransition(pathname: string) {
  const [key, setKey] = useState(pathname);

  useLayoutEffect(() => {
    setKey(pathname);
  }, [pathname]);

  return key;
}
