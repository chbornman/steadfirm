import { useEffect, useState } from 'react';
import { Button, Typography, Divider, Tag, Grid, Spin } from 'antd';
import { DownloadSimple } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';

const { useBreakpoint } = Grid;

export interface PlainTextViewerProps {
  downloadUrl: string;
  document: {
    title: string;
    correspondent?: string;
    tags: string[];
    dateCreated: string;
    originalFileName?: string;
  };
  onDownload: () => void;
}

export function PlainTextViewer({ downloadUrl, document, onDownload }: PlainTextViewerProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchContent() {
      try {
        const resp = await fetch(downloadUrl);
        if (!resp.ok) {
          throw new Error(`Failed to fetch document (${resp.status})`);
        }
        const text = await resp.text();
        if (!cancelled) {
          setContent(text);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document');
          setLoading(false);
        }
      }
    }

    void fetchContent();
    return () => { cancelled = true; };
  }, [downloadUrl]);

  const lineCount = content ? content.split('\n').length : 0;

  const metadataPanel = (
    <div
      style={{
        flex: isMobile ? undefined : '0 0 30%',
        minWidth: isMobile ? undefined : 240,
        maxWidth: isMobile ? undefined : 320,
        padding: 20,
        borderLeft: isMobile ? undefined : '1px solid var(--ant-color-border)',
        borderBottom: isMobile ? '1px solid var(--ant-color-border)' : undefined,
        overflow: 'auto',
      }}
    >
      <Typography.Title level={4} style={{ margin: 0 }}>
        {document.title}
      </Typography.Title>

      {document.correspondent && (
        <Typography.Text
          type="secondary"
          style={{ display: 'block', marginTop: 8, fontSize: 13 }}
        >
          {document.correspondent}
        </Typography.Text>
      )}

      <Divider style={{ margin: '16px 0' }} />

      <div style={{ marginBottom: 12 }}>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          Date
        </Typography.Text>
        <div style={{ marginTop: 4, fontSize: 14 }}>
          {new Date(document.dateCreated).toLocaleDateString()}
        </div>
      </div>

      {document.originalFileName && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            File
          </Typography.Text>
          <div style={{ marginTop: 4, fontSize: 14, wordBreak: 'break-all' }}>
            {document.originalFileName}
          </div>
        </div>
      )}

      {lineCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Lines
          </Typography.Text>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            {lineCount.toLocaleString()}
          </div>
        </div>
      )}

      {document.tags.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              display: 'block',
              marginBottom: 8,
            }}
          >
            Tags
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {document.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        </div>
      )}

      <Divider style={{ margin: '16px 0' }} />

      <Button
        type="primary"
        icon={<DownloadSimple size={16} weight="bold" />}
        onClick={onDownload}
        block
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: cssVar.accent,
        }}
      >
        Download
      </Button>
    </div>
  );

  const textContent = (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header bar (mirrors PDF viewer toolbar) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--ant-color-border)',
          flexShrink: 0,
          fontSize: 13,
          color: 'var(--ant-color-text-secondary)',
        }}
      >
        {lineCount > 0 && <span>{lineCount.toLocaleString()} lines</span>}
      </div>

      {/* Text content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          background: 'var(--ant-color-bg-layout)',
        }}
      >
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        )}
        {error && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ant-color-error)' }}>
            {error}
          </div>
        )}
        {content != null && (
          <pre
            style={{
              margin: 0,
              padding: 16,
              background: 'var(--ant-color-bg-container)',
              border: '1px solid var(--ant-color-border)',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace",
              overflow: 'visible',
            }}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        height: '100%',
        minHeight: 0,
      }}
    >
      {isMobile && metadataPanel}
      {textContent}
      {!isMobile && metadataPanel}
    </div>
  );
}
