/**
 * Floating dev-only toggle to switch LLM providers at runtime.
 *
 * Shows the active provider (Anthropic / Local) and lets you switch
 * with a single click. Hidden in production builds.
 */

import { useCallback, useEffect, useState } from 'react';
import { theme } from 'antd';
import { api } from '@/api/client';

interface ProviderInfo {
  provider: string;
  model: string;
  enabled: boolean;
}

type Provider = 'anthropic' | 'local';

const LABELS: Record<Provider, string> = {
  anthropic: 'Claude',
  local: 'Local',
};

const COLORS: Record<Provider, string> = {
  anthropic: '#D97706',
  local: '#22C55E',
};

export function DevLlmToggle() {
  const { token } = theme.useToken();
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [switching, setSwitching] = useState(false);

  // Don't render in production
  if (import.meta.env.PROD) return null;

  // Fetch current provider on mount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    void api
      .get('api/v1/classify/provider')
      .json<ProviderInfo>()
      .then(setInfo)
      .catch(() => {
        /* backend may not be running */
      });
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const toggle = useCallback(async () => {
    if (!info || switching) return;
    setSwitching(true);

    const current = info.provider === 'anthropic' ? 'anthropic' : 'local';
    const next: Provider = current === 'anthropic' ? 'local' : 'anthropic';

    try {
      const result = await api
        .put('api/v1/classify/provider', { json: { provider: next } })
        .json<ProviderInfo>();
      setInfo(result);
    } catch {
      /* ignore */
    } finally {
      setSwitching(false);
    }
  }, [info, switching]);

  if (!info) return null;

  const provider: Provider =
    info.provider === 'anthropic' ? 'anthropic' : 'local';
  const color = COLORS[provider];
  const label = LABELS[provider];

  return (
    <button
      onClick={() => void toggle()}
      disabled={switching}
      title={`LLM: ${info.provider} / ${info.model}${info.enabled ? '' : ' (disabled)'}\nClick to switch`}
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px 5px 8px',
        border: `1px solid ${color}40`,
        borderRadius: 9999,
        background: token.colorBgElevated,
        cursor: switching ? 'wait' : 'pointer',
        opacity: switching ? 0.6 : 1,
        fontSize: 11,
        fontFamily: 'monospace',
        fontWeight: 600,
        color,
        transition: 'all 0.15s ease',
        boxShadow: `0 2px 8px ${color}20`,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: info.enabled ? color : '#666',
          flexShrink: 0,
        }}
      />
      {label}
    </button>
  );
}
