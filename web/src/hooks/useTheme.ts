import { useThemeStore } from '@/stores/theme';

export function useTheme() {
  const mode = useThemeStore((s) => s.mode);
  const resolved = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);

  const cycleMode = () => {
    if (mode === 'dark') setMode('light');
    else if (mode === 'light') setMode('system');
    else setMode('dark');
  };

  return { mode, resolved, setMode, cycleMode };
}
