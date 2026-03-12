import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spin, Drawer, Typography } from 'antd';
import { List, CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { BookInfo, BookTocEntry } from '@steadfirm/shared';
import { readingQueries, bookResourceUrl } from '@/api/reading';
import { cssVar } from '@steadfirm/theme';

export interface EpubReaderProps {
  chapterId: number;
  bookInfo: BookInfo;
  initialPage: number;
  onPageChange: (page: number) => void;
  onChapterEnd: () => void;
  onChapterStart: () => void;
}

/**
 * EPUB reader that loads Kavita's pre-rendered HTML pages.
 * Each "page" is an EPUB spine item rendered to scoped HTML by Kavita.
 * Embedded resources (images, fonts) are rewritten to use our proxy.
 */
export function EpubReader({
  chapterId,
  bookInfo,
  initialPage,
  onPageChange,
  onChapterEnd,
  onChapterStart,
}: EpubReaderProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [tocOpen, setTocOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const totalPages = bookInfo.pages;

  // Fetch the current page HTML
  const { data: pageHtml, isLoading } = useQuery({
    ...readingQueries.bookPage(chapterId, currentPage),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch table of contents
  const { data: toc } = useQuery({
    ...readingQueries.bookToc(chapterId),
    staleTime: Infinity,
  });

  const goToPage = useCallback(
    (page: number) => {
      if (page < 0) {
        onChapterStart();
        return;
      }
      if (page >= totalPages) {
        onChapterEnd();
        return;
      }
      setCurrentPage(page);
      onPageChange(page);
      contentRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    },
    [totalPages, onPageChange, onChapterEnd, onChapterStart],
  );

  // Rewrite resource URLs in the HTML to point to our proxy
  const processedHtml = pageHtml ? rewriteResourceUrls(pageHtml, chapterId) : '';

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
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
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--ant-color-border)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setTocOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--ant-color-text-secondary)',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
          }}
        >
          <List size={16} />
          Contents
        </button>

        <span
          style={{
            fontSize: 13,
            color: 'var(--ant-color-text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {currentPage + 1} / {totalPages}
        </span>
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px 16px',
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            lineHeight: 1.7,
            fontSize: 17,
          }}
        >
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
              <Spin size="large" />
            </div>
          ) : (
            <div
              dangerouslySetInnerHTML={{ __html: processedHtml }}
              style={{ wordBreak: 'break-word' }}
            />
          )}
        </div>
      </div>

      {/* Bottom navigation */}
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
          disabled={currentPage <= 0}
          style={{
            background: 'none',
            border: 'none',
            cursor: currentPage > 0 ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: currentPage > 0 ? 'var(--ant-color-text)' : 'var(--ant-color-text-quaternary)',
            fontSize: 13,
            padding: '6px 12px',
            borderRadius: 4,
          }}
        >
          <CaretLeft size={14} weight="bold" />
          Previous
        </button>

        {/* Progress bar */}
        <div style={{ flex: 1, maxWidth: 200, margin: '0 16px' }}>
          <div
            style={{
              height: 3,
              background: 'var(--ant-color-border)',
              borderRadius: 2,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${((currentPage + 1) / totalPages) * 100}%`,
                background: cssVar.accent,
                borderRadius: 2,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        </div>

        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages - 1}
          style={{
            background: 'none',
            border: 'none',
            cursor: currentPage < totalPages - 1 ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color:
              currentPage < totalPages - 1
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

      {/* Table of Contents Drawer */}
      <Drawer
        title="Table of Contents"
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        placement="left"
        width={320}
      >
        {toc && (
          <TocTree
            entries={toc}
            onSelect={(page) => {
              goToPage(page);
              setTocOpen(false);
            }}
            currentPage={currentPage}
          />
        )}
      </Drawer>
    </div>
  );
}

// ─── Table of Contents tree ──────────────────────────────────────────

function TocTree({
  entries,
  onSelect,
  currentPage,
  depth = 0,
}: {
  entries: BookTocEntry[];
  onSelect: (page: number) => void;
  currentPage: number;
  depth?: number;
}) {
  return (
    <div>
      {entries.map((entry, i) => (
        <div key={`${entry.page}-${i}`}>
          <button
            onClick={() => onSelect(entry.page)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              paddingLeft: 12 + depth * 16,
              background:
                entry.page === currentPage ? 'var(--ant-color-bg-text-hover)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              color: entry.page === currentPage ? cssVar.accent : 'var(--ant-color-text)',
              fontWeight: entry.page === currentPage ? 600 : 400,
              borderRadius: 4,
              lineHeight: 1.5,
            }}
          >
            <Typography.Text
              ellipsis
              style={{
                color: 'inherit',
                fontWeight: 'inherit',
                fontSize: 'inherit',
              }}
            >
              {entry.title}
            </Typography.Text>
          </button>
          {entry.children.length > 0 && (
            <TocTree
              entries={entry.children}
              onSelect={onSelect}
              currentPage={currentPage}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Resource URL rewriting ──────────────────────────────────────────

/**
 * Kavita rewrites EPUB HTML to reference resources via its own endpoints.
 * We need to rewrite those URLs to point to our proxy instead.
 */
function rewriteResourceUrls(html: string, chapterId: number): string {
  return html.replace(
    /\/api\/Book\/\d+\/book-resources\?file=([^"'&]+)/g,
    (_match: string, file: string) => bookResourceUrl(chapterId, decodeURIComponent(file)),
  );
}
