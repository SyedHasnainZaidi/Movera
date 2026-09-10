import { create } from 'zustand';
import {
  api,
  setAccessToken,
  setUnauthenticatedHandler,
} from '../api/client';
import type { AuthResponse, AuthUser } from '../types/api';

interface AuthState {
  user: AuthUser | null;
  /** True until the initial refresh attempt settles - guards route flicker. */
  initialising: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<RegistrationResult>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  clear: () => void;
}

/**
 * What POST /auth/register returns now.
 *
 * No token and no user: the account is created unverified and the backend
 * refuses to sign it in until the emailed link has been followed.
 */
export interface RegistrationResult {
  email: string;
  emailVerificationRequired: boolean;
  /** False when the backend could not hand the message to a mail server. */
  verificationEmailSent: boolean;
  message: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'THERAPIST';
  timezone?: string;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialising: true,

  login: async (email, password) => {
    const { data } = await api.post<AuthResponse>('/auth/login', {
      email,
      password,
    });
    setAccessToken(data.accessToken);
    set({ user: data.user, initialising: false });
    return data.user;
  },

  /**
   * Creates the account but does NOT sign in.
   *
   * Auth state is deliberately left untouched: the user stays signed out until
   * they verify their email and log in, which is exactly what the backend
   * enforces. Setting a user here would show them an app they cannot actually
   * make requests against.
   */
  register: async (input) => {
    const { data } = await api.post<RegistrationResult>('/auth/register', {
      ...input,
      timezone:
        input.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        'UTC',
    });
    return data;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // A failed logout must still clear local state - the user asked to leave.
    }
    setAccessToken(null);
    set({ user: null, initialising: false });
  },

  /**
   * Called once on app start.
   *
   * The access token lives only in memory, so a page reload always begins
   * signed out. The HttpOnly refresh cookie is what restores the session -
   * one silent refresh, and the user never sees a login screen they did not
   * ask for.
   */
  restore: async () => {
    try {
      const { data } = await api.post<AuthResponse>('/auth/refresh');
      setAccessToken(data.accessToken);
      set({ user: data.user, initialising: false });
    } catch {
      // No valid cookie: a normal signed-out start, not an error worth showing.
      setAccessToken(null);
      set({ user: null, initialising: false });
    }
  },

  clear: () => {
    setAccessToken(null);
    set({ user: null, initialising: false });
  },
}));

// When a refresh finally fails mid-session, drop to signed-out rather than
// leaving the UI showing stale data it can no longer load.
setUnauthenticatedHandler(() => {
  useAuthStore.getState().clear();
});
