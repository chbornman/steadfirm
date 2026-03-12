import { useState, useEffect, useCallback } from 'react';
import { Spin } from 'antd';
import { Document, Page, pdfjs } from 'react-pdf';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { pdfUrl } from '@/api/reading';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface PdfReaderProps {
  chapterId: number;
  initialPage: number;
  onPageChange: (page: number) => void;
}

/**
 * PDF reader using react-pdf (pdf.js).
 * Loads the raw PDF from our Kavita proxy and renders pages client-side.
 */
export function PdfReader({ chapterId, initialPage, onPageChange }: PdfReaderProps) {
  // react-pdf uses 1-indexed pages, Kavita uses 0-indexed
  const [currentPage, setCurrentPage] = useState(initialPage + 1);
  const [totalPages, setTotalPages] = useState(0);

  const fileUrl = pdfUrl(chapterId);

  const goToPage = useCallback(
    (page: number) => {
      if (page < 1 || (totalPages > 0 && page > totalPages)) return;
      setCurrentPage(page);
      onPageChange(page - 1); // convert to 0-indexed for progress
    },
    [totalPages, onPageChange],
  );

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goToPage(currentPage + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPage(currentPage - 1);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentPage, goToPage]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ant-color-bg-container)',
      }}
    >
      {/* PDF content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages }) => {
            setTotalPages(numPages);
          }}
          loading={
            <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
              <Spin size="large" />
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={Math.min(window.innerWidth - 64, 800)}
            loading=""
          />
        </Document>
      </div>

      {/* Bottom navigation */}
      {totalPages > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            borderTop: '1px solid var(--ant-color-border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            style={{
              background: 'none',
              border: 'none',
              cursor: currentPage > 1 ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: currentPage > 1 ? 'var(--ant-color-text)' : 'var(--ant-color-text-quaternary)',
              fontSize: 13,
              padding: '6px 12px',
              borderRadius: 4,
            }}
          >
            <CaretLeft size={14} weight="bold" />
            Previous
          </button>

          <span
            style={{
              fontSize: 13,
              color: 'var(--ant-color-text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {currentPage} / {totalPages}
          </span>

          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            style={{
              background: 'none',
              border: 'none',
              cursor: currentPage < totalPages ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color:
                currentPage < totalPages
                  ? 'var(--ant-color-text)'
                  : 'var(--ant-color-text-quaternary)',
              fontSize: 13,
              padding: '6px 12px',
              borderRadius: 4,
            }}
          >
            Next
            <CaretRight size={14} weight="bold" />
          </button>
        </div>
      )}

      {/* Progress bar */}
      {totalPages > 0 && (
        <div
          style={{
            height: 3,
            background: 'var(--ant-color-border)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${(currentPage / totalPages) * 100}%`,
              background: cssVar.accent,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      )}
    </div>
  );
}
