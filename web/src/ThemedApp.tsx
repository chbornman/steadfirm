import { ConfigProvider, App as AntApp } from 'antd';
import { RouterProvider } from '@tanstack/react-router';
import { darkTheme, lightTheme } from '@steadfirm/theme';
import { useThemeStore } from '@/stores/theme';
import { router } from '@/router';
import { DebugPanel } from '@/components/DebugPanel';
import { DevLlmToggle } from '@/components/DevLlmToggle';

export function ThemedApp() {
  const resolved = useThemeStore((s) => s.resolved);
  const themeConfig = resolved === 'dark' ? darkTheme : lightTheme;

  return (
    <ConfigProvider theme={themeConfig}>
      <AntApp>
        <RouterProvider router={router} />
        <DebugPanel />
        <DevLlmToggle />
      </AntApp>
    </ConfigProvider>
  );
}
