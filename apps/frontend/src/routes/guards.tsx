import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { UserRole } from '../types/api';

/**
 * Route guards.
 *
 * These are a NAVIGATION convenience, not a security boundary. Every protected
 * resource is authorised server-side; hiding a link never protects data. Their
 * job is to keep a patient from landing on a therapist screen that would only
 * render a wall of 403s.
 */

function FullPageSpinner() {
  return (
    <div className="grid min-h-full place-items-center" role="status">
      <div className="flex flex-col items-center gap-3">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent"
          aria-hidden="true"
        />
        <span className="text-sm text-ink-500">Loading…</span>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const initialising = useAuthStore((state) => state.initialising);
  const location = useLocation();

  // Wait for the silent refresh to settle. Redirecting during initialisation
  // would bounce a signed-in user to /login on every page reload.
  if (initialising) return <FullPageSpinner />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

export function RoleRoute({
  role,
  children,
}: {
  role: UserRole;
  children: ReactNode;
}) {
  const user = useAuthStore((state) => state.user);
  const initialising = useAuthStore((state) => state.initialising);

  if (initialising) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  if (user.role !== role) {
    // Send them to their own home rather than showing a dead end.
    return (
      <Navigate
        to={user.role === 'THERAPIST' ? '/therapist' : '/patient'}
        replace
      />
    );
  }

  return <>{children}</>;
}

export function RootRedirect() {
  const user = useAuthStore((state) => state.user);
  const initialising = useAuthStore((state) => state.initialising);

  if (initialising) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Navigate to={user.role === 'THERAPIST' ? '/therapist' : '/patient'} replace />
  );
}
