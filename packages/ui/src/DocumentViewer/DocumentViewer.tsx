import { useState, useCallback } from 'react';
import { Button, Tag, Typography, Divider, Grid, InputNumber } from 'antd';
import {
  DownloadSimple,
  CaretLeft,
  CaretRight,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { Document as PdfDocument, Page as PdfPage, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

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

  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setCurrentPage(1);
  }, []);

  const goToPrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setCurrentPage((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(3, s + 0.25));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.25));

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

      {(document.pageCount != null || numPages > 0) && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Pages
          </Typography.Text>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            {document.pageCount ?? numPages}
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

  const pdfViewer = (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Page navigation + zoom controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--ant-color-border)',
          flexShrink: 0,
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<CaretLeft size={16} />}
          onClick={goToPrevPage}
          disabled={currentPage <= 1}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <InputNumber
            min={1}
            max={numPages || 1}
            value={currentPage}
            onChange={(v) => {
              if (v != null) setCurrentPage(v);
            }}
            size="small"
            style={{ width: 56 }}
            controls={false}
          />
          <span style={{ color: 'var(--ant-color-text-secondary)' }}>/ {numPages}</span>
        </div>
        <Button
          type="text"
          size="small"
          icon={<CaretRight size={16} />}
          onClick={goToNextPage}
          disabled={currentPage >= numPages}
        />

        <div style={{ width: 1, height: 20, background: 'var(--ant-color-border)', margin: '0 4px' }} />

        <Button
          type="text"
          size="small"
          icon={<MagnifyingGlassMinus size={16} />}
          onClick={zoomOut}
          disabled={scale <= 0.5}
        />
        <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
          {Math.round(scale * 100)}%
        </span>
        <Button
          type="text"
          size="small"
          icon={<MagnifyingGlassPlus size={16} />}
          onClick={zoomIn}
          disabled={scale >= 3}
        />
      </div>

      {/* PDF content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          padding: 16,
          background: 'var(--ant-color-bg-layout)',
        }}
      >
        <PdfDocument
          file={previewUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
              Loading PDF...
            </div>
          }
          error={
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
              Failed to load PDF
            </div>
          }
        >
          <PdfPage
            pageNumber={currentPage}
            scale={scale}
            loading={
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
                Loading page...
              </div>
            }
          />
        </PdfDocument>
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
      {pdfViewer}
      {!isMobile && metadataPanel}
    </div>
  );
}
