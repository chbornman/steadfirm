import type { ReactNode } from 'react';
import { cssVar } from '@steadfirm/theme';

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
        background: cssVar.authBg,
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>{children}</div>
    </div>
  );
}
