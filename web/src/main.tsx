import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@steadfirm/theme/global.css';
import { useThemeStore } from '@/stores/theme';
import { ThemedApp } from '@/ThemedApp';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.getElementById('root');
if (rootEl) {
  const initialResolved = useThemeStore.getState().resolved;
  document.documentElement.setAttribute('data-theme', initialResolved);

  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemedApp />
      </QueryClientProvider>
    </StrictMode>,
  );
}
