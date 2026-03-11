import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '@steadfirm/theme/global.css';
import { useThemeStore } from '@/stores/theme';
import { queryClient } from '@/query-client';
import { ThemedApp } from '@/ThemedApp';

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
