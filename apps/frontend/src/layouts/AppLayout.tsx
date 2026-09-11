import { useQuery } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { api } from '../api/client';
import { MoveraBrand, MoveraMark } from '../components/MoveraLogo';
import { PoseFigure } from '../components/PoseFigure';
import {
  usePageTransition,
  useScrolled,
  useScrollProgress,
} from '../components/motion';
import { ThemeToggle } from '../components/ThemeToggle';
import { Badge, Button } from '../components/ui';
import { useAuthStore } from '../stores/authStore';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const PATIENT_NAV: NavItem[] = [
  { to: '/patient', label: 'Overview', end: true },
  { to: '/patient/plans', label: 'My plans' },
  { to: '/patient/sessions', label: 'History' },
  { to: '/patient/progress', label: 'Progress' },
  { to: '/patient/therapist', label: 'My therapist' },
  { to: '/patient/notifications', label: 'Notifications' },
];

const THERAPIST_NAV: NavItem[] = [
  { to: '/therapist', label: 'Overview', end: true },
  { to: '/therapist/patients', label: 'Patients' },
  { to: '/therapist/exercises', label: 'Exercise library' },
  { to: '/therapist/notifications', label: 'Notifications' },
];

/**
 * Position of the marker that sits under the current section.
 *
 * Measured from the DOM rather than derived from the route, because the width
 * of a tab depends on its text - which changes with the loaded typeface, the
 * user's font size and the language. Anything computed up front would be wrong
 * on the first paint and wrong again when Archivo arrives.
 */
function useActiveMarker(dependency: string) {
  const navRef = useRef<HTMLElement | null>(null);
  const [marker, setMarker] = useState<{ left: number; width: number } | null>(
    null,
  );

  const measure = useCallback(() => {
    const nav = navRef.current;
    // NavLink marks the current route with aria-current, so the marker can
    // find its target without a second source of truth about which tab is on.
    const active = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!nav || !active) {
      setMarker(null);
      return;
    }
    setMarker({ left: active.offsetLeft, width: active.offsetWidth });
    active.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, []);

  useLayoutEffect(() => {
    measure();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    if (navRef.current) observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [measure, dependency]);

  return { navRef, marker };
}

export function AppLayout() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { data } = await api.get<{ unreadCount: number }>(
        '/notifications?limit=1',
      );
      return data.unreadCount;
    },
    refetchInterval: 60_000,
    enabled: Boolean(user),
  });

  const nav = user?.role === 'THERAPIST' ? THERAPIST_NAV : PATIENT_NAV;
  const { navRef, marker } = useActiveMarker(location.pathname);
  const scrolled = useScrolled(6);
  const progress = useScrollProgress();
  const pageKey = usePageTransition(location.pathname);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-col">
      {/*
        Sticky, because the navigation is how a patient gets out of a screen
        they opened by mistake, and on a phone that screen can be long.

        At rest it sits flush on the page. Once content has moved underneath it
        the border and shadow appear and the bar tightens - which answers the
        scroll by saying the header is now floating over something rather than
        sitting on it, and buys back a few pixels of reading height on a phone.
      */}
      <header
        className={`sticky top-0 z-20 bg-surface/85 backdrop-blur-md transition-[box-shadow,border-color,padding] duration-[220ms] ease-[cubic-bezier(0.16,0.84,0.44,1)] ${
          scrolled
            ? 'border-b border-ink-200 shadow-panel'
            : 'border-b border-transparent'
        }`}
      >
        {/*
          How far through the page the reader is. A one-pixel rule rather than
          a bar: on a long caseload or session history it answers "am I near
          the end of this list" without taking any room to do it.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left bg-brand-500/70"
          style={{
            transform: `scaleX(${progress})`,
            opacity: progress > 0.005 ? 1 : 0,
            transition: 'opacity 200ms ease',
          }}
        />

        <div
          className={`mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 transition-[padding] duration-[220ms] ease-[cubic-bezier(0.16,0.84,0.44,1)] ${
            scrolled ? 'py-2' : 'py-3'
          }`}
        >
          <MoveraBrand />

          <nav
            aria-label="Main"
            ref={navRef}
            className="relative order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 sm:order-none sm:w-auto"
          >
            {/*
              One marker that travels, rather than a background that appears
              under whichever tab is active. The movement is the answer to the
              navigation: it shows where you came from and where you landed,
              which a swapped background colour cannot.
            */}
            {marker && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 h-full rounded-panel bg-brand-50 transition-[transform,width] duration-[260ms] ease-[cubic-bezier(0.16,0.84,0.44,1)]"
                style={{
                  width: marker.width,
                  transform: `translateX(${marker.left}px)`,
                }}
              />
            )}

            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-panel px-3 py-1.5 text-sm font-medium transition-colors duration-[140ms] ${
                    isActive
                      ? 'text-brand-800'
                      : 'text-ink-600 hover:text-ink-900'
                  }`
                }
              >
                {item.label}
                {item.label === 'Notifications' && (notifications ?? 0) > 0 && (
                  <Badge tone="problem">{notifications}</Badge>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs capitalize text-ink-500">
                {user?.role.toLowerCase()}
              </p>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/*
        Keyed on the path so every navigation replays one short entrance. A new
        screen that simply appears is indistinguishable from the same screen
        redrawing; a screen that arrives tells you the link worked.
      */}
      <main key={pageKey} className="page-enter flex-1">
        <Outlet />
      </main>

      <footer className="mt-8 border-t border-ink-200">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex items-center gap-2">
            <MoveraMark size="sm" />
            <p className="text-xs font-medium text-ink-600">
              Rehabilitation monitoring
            </p>
          </div>
          <p className="mt-3 max-w-prose text-xs leading-relaxed text-ink-500">
            Academic prototype for rehabilitation support. Not a medical device,
            not clinically certified, and not a substitute for professional
            assessment. Exercise thresholds are demonstration defaults awaiting
            physiotherapist validation.
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * The signed-out shell.
 *
 * The right-hand panel carries the only motion in the application that nobody
 * asked for: a figure performing a shoulder abduction, tracked exactly as the
 * live session tracks a patient. It is there because this is the one screen
 * where a visitor has no idea what the product does, and showing them is
 * faster and more honest than a paragraph claiming it.
 */
export function AuthLayout() {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative flex items-center justify-center px-6 py-12">
        {/*
          The theme control has to be reachable before anyone signs in - the
          sign-in screen is the one a reader with light sensitivity meets
          first, and the application header that normally carries it does not
          exist yet.
        */}
        <ThemeToggle className="absolute right-4 top-4" />

        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <MoveraMark size="lg" />
            <span className="type-display text-[26px] text-ink-900">
              Movera
            </span>
          </div>
          <Outlet />
        </div>
      </div>

      {/*
        Figure above, words below.

        Centring both put them on the same axis, and the arms swung through the
        headline at every window width narrow enough to matter. Stacking them
        gives the movement the top of the panel to happen in and leaves the
        copy a clear field underneath - which also reads in the order it should
        be read: see what it does, then read what it is.
      */}
      <div className="relative hidden overflow-hidden bg-stage px-12 py-14 lg:flex lg:flex-col lg:justify-end">
        {/*
          A single soft light behind the figure. The one gradient in the
          application, and it is doing a job: it seats the figure in space and
          pulls the eye to it before the copy.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(110%_75%_at_72%_38%,var(--color-stage-glow)_0%,var(--color-stage)_62%)]"
        />

        <PoseFigure className="pointer-events-none absolute inset-x-0 top-[3%] mx-auto h-[54%] w-auto text-brand-400" />

        {/*
          A scrim under the copy.

          The figure's legs reach into the top of the text on a short window.
          Fading the ground back to solid from the bottom keeps the words
          unambiguously first without shrinking the figure until it says
          nothing.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(0deg,var(--color-stage)_18%,rgb(11_18_17/0.82)_52%,transparent_100%)]"
        />

        <div className="relative max-w-sm">
          <h2 className="type-display text-[32px] leading-[1.15] text-white">
            Rehabilitation exercises, guided by your own camera.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-stage-200">
            {/* "counts your repetitions" was true of every exercise until
                postural work arrived, which is measured in time held instead. */}
            Your physiotherapist prescribes the programme. Movera watches your
            form as you exercise, tracks your progress through it, and shares
            the results with your therapist.
          </p>

          {/*
            A definition list, not a bulleted sales list. Each line answers a
            question a patient actually asks before they let an application
            turn their camera on, so the question is printed alongside the
            answer instead of being guessed at.
          */}
          <dl className="mt-10 space-y-4 border-l border-white/15 pl-5">
            <div>
              <dt className="text-sm font-medium text-white">
                What you need
              </dt>
              <dd className="mt-0.5 text-sm text-stage-300">
                An ordinary webcam. No extra hardware, no wearables.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-white">
                What happens to the video
              </dt>
              <dd className="mt-0.5 text-sm text-stage-300">
                Frames are analysed and discarded. Nothing is recorded.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-white">Who can see it</dt>
              <dd className="mt-0.5 text-sm text-stage-300">
                Only the physiotherapist linked to your account.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
