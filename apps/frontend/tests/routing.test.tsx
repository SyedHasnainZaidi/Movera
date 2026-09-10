import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProtectedRoute, RoleRoute, RootRedirect } from '../src/routes/guards';
import { useAuthStore } from '../src/stores/authStore';
import type { AuthUser } from '../src/types/api';

/**
 * Route guards.
 *
 * These are navigation ergonomics, NOT the security boundary - every protected
 * resource is authorised server-side and covered by the backend e2e suite.
 * What is verified here is that a signed-in user is never bounced to /login on
 * reload, and that each role lands somewhere useful rather than on a wall of
 * 403s.
 */

const patient: AuthUser = {
  id: 'u1',
  email: 'p@example.com',
  role: 'PATIENT',
  firstName: 'Ahmed',
  lastName: 'Raza',
  timezone: 'Asia/Karachi',
  patientProfileId: 'p1',
};

const therapist: AuthUser = {
  id: 'u2',
  email: 't@example.com',
  role: 'THERAPIST',
  firstName: 'Ayesha',
  lastName: 'Khan',
  timezone: 'Asia/Karachi',
  therapistProfileId: 't1',
};

function setAuth(user: AuthUser | null, initialising = false) {
  useAuthStore.setState({ user, initialising });
}

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/login" element={<p>Login screen</p>} />
        <Route path="/patient" element={<p>Patient home</p>} />
        <Route path="/therapist" element={<p>Therapist home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => setAuth(null));

  it('shows a spinner while the silent refresh is still running', () => {
    setAuth(null, true);
    renderAt('/secret', <ProtectedRoute>Secret</ProtectedRoute>);

    // Redirecting during initialisation would bounce a signed-in user to
    // /login on every page reload - the access token lives in memory only.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
  });

  it('redirects to login once we know there is no session', () => {
    setAuth(null, false);
    renderAt('/secret', <ProtectedRoute>Secret</ProtectedRoute>);
    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });

  it('renders the page for a signed-in user', () => {
    setAuth(patient);
    renderAt('/secret', <ProtectedRoute>Secret content</ProtectedRoute>);
    expect(screen.getByText('Secret content')).toBeInTheDocument();
  });
});

describe('RoleRoute', () => {
  it('lets a patient into a patient route', () => {
    setAuth(patient);
    renderAt(
      '/secret',
      <RoleRoute role="PATIENT">Patient area</RoleRoute>,
    );
    expect(screen.getByText('Patient area')).toBeInTheDocument();
  });

  it('sends a therapist who lands on a patient route to their own home', () => {
    setAuth(therapist);
    renderAt(
      '/secret',
      <RoleRoute role="PATIENT">Patient area</RoleRoute>,
    );
    // Not a dead end and not a 403 wall - the therapist's own dashboard.
    expect(screen.getByText('Therapist home')).toBeInTheDocument();
  });

  it('sends a patient who lands on a therapist route to their own home', () => {
    setAuth(patient);
    renderAt(
      '/secret',
      <RoleRoute role="THERAPIST">Therapist area</RoleRoute>,
    );
    expect(screen.getByText('Patient home')).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login', () => {
    setAuth(null);
    renderAt(
      '/secret',
      <RoleRoute role="PATIENT">Patient area</RoleRoute>,
    );
    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });
});

describe('RootRedirect', () => {
  it('routes a patient to the patient dashboard', () => {
    setAuth(patient);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/patient" element={<p>Patient home</p>} />
          <Route path="/therapist" element={<p>Therapist home</p>} />
          <Route path="/login" element={<p>Login screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Patient home')).toBeInTheDocument();
  });

  it('routes a therapist to the therapist dashboard', () => {
    setAuth(therapist);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/patient" element={<p>Patient home</p>} />
          <Route path="/therapist" element={<p>Therapist home</p>} />
          <Route path="/login" element={<p>Login screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Therapist home')).toBeInTheDocument();
  });
});
