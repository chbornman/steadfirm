import { useCallback, useState } from 'react';
import { Badge, Button, Typography, Tag, Empty, Tooltip, App, theme } from 'antd';
import {
  Bug,
  Trash,
  CaretDown,
  CaretRight,
  Robot,
  Clock,
  ArrowRight,
  Copy,
  Check,
  X,
} from '@phosphor-icons/react';
import { typography, colors, spacing } from '@steadfirm/theme';
import { useDebugStore, DEBUG_PANEL_WIDTH } from '@/stores/debug';
import type { DebugLogPair } from '@/stores/debug';

const { Text, Paragraph } = Typography;

/** Floating debug toggle button + side panel. Only shown in dev mode. */
export function DebugPanel() {
  const { token } = theme.useToken();
  const visible = useDebugStore((s) => s.visible);
  const pairs = useDebugStore((s) => s.pairs);
  const toggleVisible = useDebugStore((s) => s.toggleVisible);
  const clearEntries = useDebugStore((s) => s.clearEntries);

  if (import.meta.env.PROD) return null;

  return (
    <>
      {/* Floating toggle button — moves left when panel is open */}
      <Tooltip title="AI Debug Panel" placement="left">
        <Button
          type={visible ? 'primary' : 'default'}
          shape="circle"
          size="large"
          icon={
            <Badge count={pairs.length} size="small" offset={[4, -4]}>
              <Bug size={20} weight={visible ? 'fill' : 'regular'} />
            </Badge>
          }
          onClick={toggleVisible}
          style={{
            position: 'fixed',
            bottom: 24,
            right: visible ? DEBUG_PANEL_WIDTH + 16 : 24,
            zIndex: 1001,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            transition: 'right 0.25s ease',
          }}
        />
      </Tooltip>

      {/* Side panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: DEBUG_PANEL_WIDTH,
          height: '100vh',
          zIndex: 900,
          display: 'flex',
          flexDirection: 'column',
          background: token.colorBgElevated,
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.12)',
          transform: visible ? 'translateX(0)' : `translateX(${DEBUG_PANEL_WIDTH}px)`,
          transition: 'transform 0.25s ease',
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            padding: '12px 16px',
            borderBottom: '1px solid var(--ant-color-border)',
            flexShrink: 0,
          }}
        >
          <Bug size={18} />
          <Text strong>AI Debug Log</Text>
          <Tag color="purple" style={{ marginLeft: 4, marginRight: 'auto' }}>
            {pairs.length} {pairs.length === 1 ? 'entry' : 'entries'}
          </Tag>
          <Button
            size="small"
            danger
            icon={<Trash size={14} />}
            onClick={clearEntries}
            disabled={pairs.length === 0}
          >
            Clear
          </Button>
          <Button
            type="text"
            size="small"
            icon={<X size={16} />}
            onClick={toggleVisible}
          />
        </div>

        {/* Scrollable body */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            fontFamily: typography.fontFamilyMono,
            fontSize: 12,
          }}
        >
          {pairs.length === 0 ? (
            <Empty
              description="No AI calls yet"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 80 }}
            />
          ) : (
            [...pairs].reverse().map((pair) => (
              <LogPairEntry key={pair.id} pair={pair} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

function LogPairEntry({ pair }: { pair: DebugLogPair }) {
  const { message } = App.useApp();
  const toggleCollapse = useDebugStore((s) => s.toggleCollapse);

  const handleToggle = useCallback(() => {
    toggleCollapse(pair.id);
  }, [pair.id, toggleCollapse]);

  const handleCopyAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const parts: string[] = [];

      if (pair.meta) {
        parts.push(
          `# ${pair.meta.provider} / ${pair.meta.model} (${pair.meta.durationMs}ms, ${pair.meta.fileCount} files)`,
        );
        parts.push('');
      }

      if (pair.prompts) {
        parts.push('## System Prompt\n');
        parts.push(pair.prompts.system);
        parts.push('\n## User Prompt\n');
        parts.push(pair.prompts.user);
        if (pair.prompts.rawResponse) {
          parts.push('\n## Raw Response\n');
          parts.push(pair.prompts.rawResponse);
        }
        parts.push('');
      }

      parts.push('## Request Body\n');
      parts.push(pair.request.data);

      if (pair.response) {
        const label =
          pair.response.type === 'error' ? '## Error' : '## Response Body';
        parts.push(`\n${label}\n`);
        parts.push(pair.response.data);
      }

      void navigator.clipboard.writeText(parts.join('\n')).then(() => {
        void message.success('Copied to clipboard');
      });
    },
    [pair, message],
  );

  const isError = pair.response?.type === 'error';

  return (
    <div
      style={{
        borderBottom: '1px solid var(--ant-color-border)',
      }}
    >
      {/* Header row */}
      <div
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          cursor: 'pointer',
          background: isError ? 'rgba(239, 68, 68, 0.06)' : 'transparent',
        }}
      >
        {pair.collapsed ? (
          <CaretRight size={14} weight="bold" />
        ) : (
          <CaretDown size={14} weight="bold" />
        )}

        <Tag
          color={isError ? 'error' : 'processing'}
          style={{ fontSize: 10 }}
        >
          {pair.request.badge ?? 'classify'}
        </Tag>

        {pair.meta && (
          <>
            <Tag
              icon={<Robot size={10} style={{ marginRight: 2 }} />}
              color="purple"
              style={{ fontSize: 10 }}
            >
              {pair.meta.model}
            </Tag>
            <Tag
              icon={<Clock size={10} style={{ marginRight: 2 }} />}
              color="default"
              style={{ fontSize: 10 }}
            >
              {pair.meta.durationMs}ms
            </Tag>
          </>
        )}

        {!pair.response && <Tag color="warning">pending...</Tag>}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title="Copy all">
            <Button
              type="text"
              size="small"
              icon={<Copy size={13} />}
              onClick={handleCopyAll}
              style={{ width: 24, height: 24, minWidth: 24 }}
            />
          </Tooltip>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {formatTime(pair.request.timestamp)}
          </Text>
        </div>
      </div>

      {/* Expanded content */}
      {!pair.collapsed && (
        <div style={{ padding: '0 12px 12px' }}>
          {/* Prompts section */}
          {pair.prompts && (
            <div style={{ marginBottom: 10 }}>
              <PromptSection
                label="System Prompt"
                content={pair.prompts.system}
              />
              <PromptSection
                label="User Prompt"
                content={pair.prompts.user}
              />
              {pair.prompts.rawResponse && (
                <PromptSection
                  label="Raw Response"
                  content={pair.prompts.rawResponse}
                />
              )}
            </div>
          )}

          {/* Request / Response */}
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 4,
              }}
            >
              <ArrowRight size={12} color={colors.info} />
              <Text strong style={{ fontSize: 11, color: colors.info }}>
                Request Body
              </Text>
            </div>
            <CodeBlock content={pair.request.data} />
          </div>

          {pair.response && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <ArrowRight
                  size={12}
                  color={isError ? colors.error : colors.success}
                />
                <Text
                  strong
                  style={{
                    fontSize: 11,
                    color: isError ? colors.error : colors.success,
                  }}
                >
                  {isError ? 'Error' : 'Response Body'}
                </Text>
              </div>
              <CodeBlock content={pair.response.data} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PromptSection({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Text
        strong
        type="secondary"
        style={{ fontSize: 11, display: 'block', marginBottom: 4 }}
      >
        {label}
      </Text>
      <CodeBlock content={content} maxLines={15} />
    </div>
  );
}

function CodeBlock({
  content,
  maxLines,
}: {
  content: string;
  maxLines?: number;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);

  // Try to pretty-print JSON
  let display = content;
  try {
    const parsed: unknown = JSON.parse(content);
    display = JSON.stringify(parsed, null, 2);
  } catch {
    // Not JSON — use as-is
  }

  const lines = display.split('\n');
  const truncated = maxLines != null && lines.length > maxLines;
  const shown = truncated ? lines.slice(0, maxLines).join('\n') : display;
  const hiddenCount = truncated ? lines.length - maxLines : 0;

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--ant-color-bg-container)',
        border: '1px solid var(--ant-color-border)',
        borderRadius: 6,
        padding: '8px 12px',
        maxHeight: 300,
        overflow: 'auto',
      }}
    >
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <Button
          type="text"
          size="small"
          icon={
            copied ? (
              <Check size={12} color={colors.success} />
            ) : (
              <Copy size={12} />
            )
          }
          onClick={handleCopy}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            minWidth: 22,
            opacity: 0.6,
          }}
        />
      </Tooltip>
      <Paragraph
        style={{
          fontFamily: typography.fontFamilyMono,
          fontSize: 11,
          lineHeight: 1.5,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          paddingRight: 20,
        }}
      >
        {shown}
        {hiddenCount > 0 && (
          <Text type="secondary">
            {'\n'}... ({hiddenCount} more lines)
          </Text>
        )}
      </Paragraph>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}
