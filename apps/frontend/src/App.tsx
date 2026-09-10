import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { useAuthStore } from './stores/authStore';
import { syncThemeToDocument, watchSystemTheme } from './stores/themeStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Clinical data is read far more often than it changes; 30s keeps the
      // dashboards responsive without hammering the API on every navigation.
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry an authorization failure - the answer will not change,
        // and retrying a 403 just delays the error the user needs to see.
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  const restore = useAuthStore((state) => state.restore);

  // One silent refresh on boot. The access token lives only in memory, so a
  // reload always starts signed out until the HttpOnly cookie restores it.
  useEffect(() => {
    void restore();
  }, [restore]);

  // Keeps an un-chosen theme following the operating system for as long as the
  // tab is open, so a machine that switches at sunset takes the app with it.
  useEffect(() => {
    syncThemeToDocument();
    return watchSystemTheme();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
