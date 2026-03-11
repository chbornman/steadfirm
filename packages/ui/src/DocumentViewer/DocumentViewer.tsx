import { Button, Tag, Typography, Divider, Grid } from 'antd';
import { DownloadSimple } from '@phosphor-icons/react';
import { colors } from '@steadfirm/theme';

const { useBreakpoint } = Grid;

export interface DocumentViewerProps {
  previewUrl: string;
  document: {
    title: string;
    correspondent?: string;
    tags: string[];
    dateCreated: string;
    pageCount?: number;
  };
  onDownload: () => void;
}

export function DocumentViewer({ previewUrl, document, onDownload }: DocumentViewerProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const metadataPanel = (
    <div
      style={{
        flex: isMobile ? undefined : '0 0 280px',
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

      {document.pageCount != null && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Pages
          </Typography.Text>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            {document.pageCount}
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
          background: colors.accent,
        }}
      >
        Download
      </Button>
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

      <div style={{ flex: 1, minHeight: 0 }}>
        <iframe
          src={previewUrl}
          title={document.title}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            minHeight: isMobile ? 500 : undefined,
          }}
        />
      </div>

      {!isMobile && metadataPanel}
    </div>
  );
}
