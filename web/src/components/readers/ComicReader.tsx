import { useState, useEffect, useCallback, useRef } from 'react';
import { Spin } from 'antd';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { ReaderChapterInfo } from '@steadfirm/shared';
import { pageImageUrl } from '@/api/reading';
import { cssVar } from '@steadfirm/theme';

export interface ComicReaderProps {
  chapterId: number;
  chapterInfo: ReaderChapterInfo;
  initialPage: number;
  onPageChange: (page: number) => void;
  onChapterEnd: () => void;
  onChapterStart: () => void;
}

/**
 * Image-based page reader for comics, manga, and image archives.
 * Pages are loaded as images from the Kavita proxy.
 */
export function ComicReader({
  chapterId,
  chapterInfo,
  initialPage,
  onPageChange,
  onChapterEnd,
  onChapterStart,
}: ComicReaderProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalPages = chapterInfo.pages;

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
      setLoading(true);
      onPageChange(page);
    },
    [totalPages, onPageChange, onChapterEnd, onChapterStart],
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

  // Click zones: left 30% = prev, right 30% = next, center = nothing
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (x < 0.3) goToPage(currentPage - 1);
      else if (x > 0.7) goToPage(currentPage + 1);
    },
    [currentPage, goToPage],
  );

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: 'pointer',
        userSelect: 'none',
        background: '#000',
      }}
    >
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
          }}
        >
          <Spin size="large" />
        </div>
      )}

      <img
        key={`${chapterId}-${currentPage}`}
        src={pageImageUrl(chapterId, currentPage)}
        alt={`Page ${currentPage + 1}`}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          opacity: loading ? 0 : 1,
          transition: 'opacity 0.15s ease',
        }}
      />

      {/* Navigation arrows */}
      {currentPage > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToPage(currentPage - 1);
          }}
          aria-label="Previous page"
          style={{
            position: 'absolute',
            left: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.5)',
            border: 'none',
            borderRadius: '50%',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#fff',
            opacity: 0.6,
            zIndex: 3,
          }}
        >
          <CaretLeft size={20} weight="bold" />
        </button>
      )}
      {currentPage < totalPages - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToPage(currentPage + 1);
          }}
          aria-label="Next page"
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.5)',
            border: 'none',
            borderRadius: '50%',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#fff',
            opacity: 0.6,
            zIndex: 3,
          }}
        >
          <CaretRight size={20} weight="bold" />
        </button>
      )}

      {/* Page indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
          padding: '4px 12px',
          borderRadius: 12,
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          zIndex: 3,
        }}
      >
        {currentPage + 1} / {totalPages}
      </div>

      {/* Progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'rgba(255,255,255,0.15)',
          zIndex: 3,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${((currentPage + 1) / totalPages) * 100}%`,
            background: cssVar.accent,
            transition: 'width 0.2s ease',
          }}
        />
      </div>
    </div>
  );
}
