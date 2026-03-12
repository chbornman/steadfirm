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
  CopySimple,
} from '@phosphor-icons/react';
import { typography, colors, spacing, radii } from '@steadfirm/theme';
import { useDebugStore, DEBUG_PANEL_WIDTH } from '@/stores/debug';
import type { DebugLogPair } from '@/stores/debug';

const { Text, Paragraph } = Typography;

/** Format a single pair into a copyable markdown string. */
function formatPairForCopy(pair: DebugLogPair): string {
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

  return parts.join('\n');
}

/** Write text to clipboard with fallback for non-HTTPS contexts. */
function writeClipboard(text: string): Promise<void> | undefined {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard) {
    return clipboard.writeText(text);
  }
  return undefined;
}

/** Floating debug toggle button + side panel. Only shown in dev mode. */
export function DebugPanel() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const visible = useDebugStore((s) => s.visible);
  const pairs = useDebugStore((s) => s.pairs);
  const toggleVisible = useDebugStore((s) => s.toggleVisible);
  const clearEntries = useDebugStore((s) => s.clearEntries);

  const handleCopyAll = useCallback(() => {
    if (pairs.length === 0) return;
    const allText = [...pairs]
      .reverse()
      .map((p, i) => `---\n## Entry ${i + 1}\n\n${formatPairForCopy(p)}`)
      .join('\n\n');
    void writeClipboard(allText)?.then(() => {
      void message.success('All entries copied');
    });
  }, [pairs, message]);

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
            padding: `${spacing.sm}px ${spacing.md}px`,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
          }}
        >
          {/* Top row: title + close */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.sm,
              marginBottom: spacing.sm,
            }}
          >
            <Bug size={18} weight="bold" color={colors.accent} />
            <Text strong style={{ fontSize: 14 }}>AI Debug Log</Text>
            <Tag
              color="purple"
              style={{ marginLeft: spacing.xs, marginRight: 'auto', fontSize: 11 }}
            >
              {pairs.length} {pairs.length === 1 ? 'entry' : 'entries'}
            </Tag>
            <Button
              type="text"
              size="small"
              icon={<X size={16} />}
              onClick={toggleVisible}
            />
          </div>

          {/* Action row: Copy All (prominent) + Clear */}
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Button
              type="primary"
              icon={<CopySimple size={16} weight="bold" />}
              onClick={handleCopyAll}
              disabled={pairs.length === 0}
              style={{ flex: 1 }}
            >
              Copy All Entries
            </Button>
            <Button
              danger
              icon={<Trash size={14} />}
              onClick={clearEntries}
              disabled={pairs.length === 0}
            >
              Clear
            </Button>
          </div>
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

  const handleCopyEntry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void writeClipboard(formatPairForCopy(pair))?.then(() => {
        void message.success('Entry copied');
      });
    },
    [pair, message],
  );

  const isError = pair.response?.type === 'error';
  const isPending = !pair.response;

  return (
    <div
      style={{
        borderBottom: `1px solid var(--ant-color-border)`,
      }}
    >
      {/* Header row */}
      <div
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          padding: `${spacing.sm}px ${spacing.md - 4}px`,
          cursor: 'pointer',
          background: isError
            ? 'rgba(239, 68, 68, 0.06)'
            : 'transparent',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!isError) e.currentTarget.style.background = 'var(--ant-color-fill-quaternary)';
        }}
        onMouseLeave={(e) => {
          if (!isError) e.currentTarget.style.background = 'transparent';
        }}
      >
        {pair.collapsed ? (
          <CaretRight size={14} weight="bold" />
        ) : (
          <CaretDown size={14} weight="bold" />
        )}

        {/* Badge + model on one line */}
        <Tag
          color={isError ? 'error' : 'processing'}
          style={{ fontSize: 10, margin: 0 }}
        >
          {pair.request.badge ?? 'classify'}
        </Tag>

        {pair.meta && (
          <Text type="secondary" style={{ fontSize: 10 }}>
            <Robot size={10} style={{ marginRight: 2, verticalAlign: 'middle' }} />
            {pair.meta.model}
            <span style={{ margin: '0 4px', opacity: 0.4 }}>|</span>
            <Clock size={10} style={{ marginRight: 2, verticalAlign: 'middle' }} />
            {pair.meta.durationMs}ms
          </Text>
        )}

        {isPending && <Tag color="warning" style={{ margin: 0 }}>pending...</Tag>}

        {/* Right side: timestamp + copy */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: spacing.xs }}>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {formatTime(pair.request.timestamp)}
          </Text>
          <Tooltip title="Copy entry">
            <Button
              size="small"
              icon={<Copy size={14} />}
              onClick={handleCopyEntry}
              style={{ minWidth: 28, width: 28, height: 28 }}
            />
          </Tooltip>
        </div>
      </div>

      {/* Expanded content */}
      {!pair.collapsed && (
        <div style={{ padding: `0 ${spacing.md}px ${spacing.md}px` }}>
          {/* Prompts section */}
          {pair.prompts && (
            <div style={{ marginBottom: spacing.sm }}>
              <SectionLabel label="Prompts" />
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
          <SectionLabel label="Request" color={colors.info} />
          <div style={{ marginBottom: spacing.sm }}>
            <CodeBlock content={pair.request.data} />
          </div>

          {pair.response && (
            <>
              <SectionLabel
                label={isError ? 'Error' : 'Response'}
                color={isError ? colors.error : colors.success}
              />
              <CodeBlock content={pair.response.data} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Small colored section label used in expanded content. */
function SectionLabel({ label, color }: { label: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.xs,
        marginBottom: spacing.xs,
        marginTop: spacing.xs,
      }}
    >
      <ArrowRight size={12} color={color ?? colors.accent} />
      <Text
        strong
        style={{ fontSize: 11, color: color ?? colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 }}
      >
        {label}
      </Text>
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
    <div style={{ marginBottom: spacing.sm }}>
      <Text
        type="secondary"
        style={{ fontSize: 10, display: 'block', marginBottom: 2, fontWeight: 600 }}
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
    void writeClipboard(content)?.then(() => {
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
        background: 'var(--ant-color-fill-quaternary)',
        border: '1px solid var(--ant-color-border)',
        borderRadius: radii.md,
        padding: `${spacing.sm}px ${spacing.sm + 4}px`,
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
