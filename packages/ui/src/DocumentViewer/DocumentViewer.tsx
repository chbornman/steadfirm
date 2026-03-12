import { Button, Typography, Divider, Tag, Grid } from 'antd';
import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { PdfViewer } from './PdfViewer';
import { PlainTextViewer } from './PlainTextViewer';
import { SpreadsheetViewer } from './SpreadsheetViewer';

const { useBreakpoint } = Grid;

/** MIME types that should use the plain text viewer. */
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-log',
  'application/rtf',
  'text/rtf',
]);

/** MIME types that should use the spreadsheet viewer. */
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'text/tab-separated-values',
  'application/csv',
]);

export interface DocumentViewerProps {
  previewUrl: string;
  downloadUrl: string;
  document: {
    title: string;
    correspondent?: string;
    tags: string[];
    dateCreated: string;
    pageCount?: number;
    mimeType?: string;
    originalFileName?: string;
    hasArchiveVersion: boolean;
  };
  onDownload: () => void;
}

type ViewerKind = 'pdf' | 'text' | 'spreadsheet' | 'download-only';

function resolveViewer(mimeType?: string, hasArchiveVersion?: boolean): ViewerKind {
  // If mime type indicates text/csv, use native viewer regardless of archive
  if (mimeType && CSV_MIME_TYPES.has(mimeType)) return 'spreadsheet';
  if (mimeType && TEXT_MIME_TYPES.has(mimeType)) return 'text';

  // If it's a PDF or has an archived PDF version, use PDF viewer
  if (mimeType === 'application/pdf') return 'pdf';
  if (hasArchiveVersion) return 'pdf';

  // Unknown type with no archive — can only offer download
  return 'download-only';
}

/** Fallback viewer shown when we can't render the document inline. */
function DownloadOnlyViewer({ document, onDownload }: {
  document: DocumentViewerProps['document'];
  onDownload: () => void;
}) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Content area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 48,
          background: 'var(--ant-color-bg-layout)',
        }}
      >
        <FileText size={64} weight="duotone" color="var(--ant-color-text-tertiary)" />
        <Typography.Title level={4} type="secondary" style={{ margin: 0 }}>
          Preview not available
        </Typography.Title>
        <Typography.Text type="secondary" style={{ textAlign: 'center', maxWidth: 400 }}>
          This document type cannot be previewed in the browser.
          {document.originalFileName && (
            <span style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
              {document.originalFileName}
            </span>
          )}
        </Typography.Text>
        <Button
          type="primary"
          size="large"
          icon={<DownloadSimple size={18} weight="bold" />}
          onClick={onDownload}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
            background: cssVar.accent,
          }}
        >
          Download Original
        </Button>
      </div>

      {/* Metadata panel */}
      <div
        style={{
          flex: isMobile ? undefined : '0 0 30%',
          minWidth: isMobile ? undefined : 240,
          maxWidth: isMobile ? undefined : 320,
          padding: 20,
          borderLeft: isMobile ? undefined : '1px solid var(--ant-color-border)',
          borderTop: isMobile ? '1px solid var(--ant-color-border)' : undefined,
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
      </div>
    </div>
  );
}

export function DocumentViewer({ previewUrl, downloadUrl, document, onDownload }: DocumentViewerProps) {
  const viewerKind = resolveViewer(document.mimeType, document.hasArchiveVersion);

  switch (viewerKind) {
    case 'pdf':
      return (
        <PdfViewer
          previewUrl={previewUrl}
          document={document}
          onDownload={onDownload}
        />
      );

    case 'text':
      return (
        <PlainTextViewer
          downloadUrl={downloadUrl}
          document={document}
          onDownload={onDownload}
        />
      );

    case 'spreadsheet':
      return (
        <SpreadsheetViewer
          downloadUrl={downloadUrl}
          document={document}
          onDownload={onDownload}
        />
      );

    case 'download-only':
      return (
        <DownloadOnlyViewer
          document={document}
          onDownload={onDownload}
        />
      );
  }
}
