import type { ReactNode } from 'react';
import { colors } from '@steadfirm/theme';

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `radial-gradient(ellipse at center, ${colors.neutral800} 0%, ${colors.neutral950} 70%)`,
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>{children}</div>
    </div>
  );
}
