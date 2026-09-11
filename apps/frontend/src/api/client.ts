import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

export const API_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

/**
 * Access tokens are held in a module variable, NOT in localStorage.
 *
 * localStorage is readable by any script on the page, so an XSS bug there
 * hands an attacker a working token. Memory dies with the tab, and the
 * HttpOnly refresh cookie restores the session on reload - the cookie itself
 * is unreadable from JavaScript.
 */
let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  // Required for the HttpOnly refresh cookie to travel with /auth requests.
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/**
 * Single-flight refresh.
 *
 * Several queries usually fail with 401 at the same moment. Without this,
 * each would fire its own refresh, and because refresh tokens ROTATE, the
 * second would present an already-rotated token - which the backend treats as
 * theft and responds to by revoking every session. So the first 401 starts one
 * refresh and the rest await it.
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string }>(
        `${API_URL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((response) => {
        const token = response.data.accessToken;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

interface RetriableRequest extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as RetriableRequest | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';

    // Never try to refresh the refresh call itself, or the login/register
    // endpoints - that is how infinite retry loops are created.
    const isAuthRoute =
      url.includes('/auth/refresh') ||
      url.includes('/auth/login') ||
      url.includes('/auth/register');

    if (status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        setAccessToken(null);
        onUnauthenticated?.();
      }
    }

    return Promise.reject(error);
  },
);

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  correlationId?: string;
  details?: unknown;
}

/**
 * Turns any thrown value into a message safe to show a user.
 *
 * Prefers the backend's own wording, which is written for patients, and never
 * exposes a raw axios/network string beyond a plain connectivity message.
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    if (error.response?.data?.message) {
      return error.response.data.message;
    }
    if (error.code === 'ECONNABORTED') {
      return 'The server took too long to respond. Please try again.';
    }
    if (!error.response) {
      return 'Could not reach the server. Check your connection and try again.';
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export function getErrorCode(error: unknown): string | null {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.code ?? null;
  }
  return null;
}

/**
 * The structured payload attached to an error, when the endpoint sends one.
 *
 * Used where a failure is caused by a specific other record and the screen has
 * to offer a way out of it - a conflicting live session the patient needs to
 * resume or cancel. Typed by the caller, because what `details` contains is a
 * property of the endpoint rather than of errors in general.
 */
export function getErrorDetails<T>(error: unknown): T | null {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return (error.response?.data?.details as T | undefined) ?? null;
  }
  return null;
}
