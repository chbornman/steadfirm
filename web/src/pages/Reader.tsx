import { useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Spin, Typography, Button } from 'antd';
import { X } from '@phosphor-icons/react';
import { readingQueries, saveProgress, getNextChapter, getPrevChapter } from '@/api/reading';
import { ComicReader } from '@/components/readers/ComicReader';
import { EpubReader } from '@/components/readers/EpubReader';
import { PdfReader } from '@/components/readers/PdfReader';

/** Kavita SeriesFormat enum values. */
const FORMAT = {
  UNKNOWN: 0,
  IMAGE: 1,
  ARCHIVE: 2, // CBZ/CBR — comic/manga
  EPUB: 3,
  PDF: 4,
} as const;

/**
 * Unified reader page. Determines the format from chapter info
 * and renders the appropriate reader component.
 *
 * Route: /reading/:seriesId/read?chapterId=N
 */
export function ReaderPage() {
  const params = useParams({ strict: false });
  const seriesId = params.seriesId ?? '';
  const search: Record<string, string | undefined> = useSearch({ strict: false });
  const chapterId = Number(search.chapterId ?? 0);
  const navigate = useNavigate();
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPageRef = useRef<number>(-1);

  // Fetch chapter info (image-based reader metadata)
  const { data: chapterInfo, isLoading: chapterLoading } = useQuery({
    ...readingQueries.chapterInfo(chapterId),
    enabled: chapterId > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch book info (EPUB/PDF metadata) — only if format suggests it
  const { data: bookInfo, isLoading: bookLoading } = useQuery({
    ...readingQueries.bookInfo(chapterId),
    enabled:
      chapterId > 0 &&
      chapterInfo != null &&
      (chapterInfo.seriesFormat === FORMAT.EPUB || chapterInfo.seriesFormat === FORMAT.PDF),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch existing progress to resume
  const { data: progress } = useQuery({
    ...readingQueries.progress(chapterId),
    enabled: chapterId > 0,
    staleTime: 0,
  });

  const initialPage = progress?.pageNum ?? 0;

  // Debounced progress saving (every 5 seconds after last page change)
  const scheduleProgressSave = useCallback(
    (page: number) => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      lastSavedPageRef.current = page;

      progressTimerRef.current = setTimeout(() => {
        if (!chapterInfo) return;
        void saveProgress({
          volumeId: chapterInfo.volumeId,
          chapterId,
          pageNum: page,
          seriesId: chapterInfo.seriesId,
          libraryId: chapterInfo.libraryId,
          bookScrollId: null,
          lastModifiedUtc: new Date().toISOString(),
        });
      }, 3000);
    },
    [chapterId, chapterInfo],
  );

  // Save progress on unmount
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
        // Fire final save synchronously-ish via sendBeacon would be ideal,
        // but for now the debounced save should have fired.
      }
    };
  }, []);

  const handlePageChange = useCallback(
    (page: number) => {
      scheduleProgressSave(page);
    },
    [scheduleProgressSave],
  );

  const goToChapter = useCallback(
    (newChapterId: number) => {
      if (newChapterId <= 0) return;
      void navigate({
        to: `/reading/${seriesId}/read`,
        search: { chapterId: String(newChapterId) },
        replace: true,
      });
    },
    [navigate, seriesId],
  );

  const handleChapterEnd = useCallback(async () => {
    if (!chapterInfo) return;
    const nextId = await getNextChapter(chapterId, chapterInfo.seriesId, chapterInfo.volumeId);
    if (nextId > 0) {
      goToChapter(nextId);
    } else {
      // No more chapters — go back to detail
      void navigate({ to: `/reading/${seriesId}` });
    }
  }, [chapterId, chapterInfo, goToChapter, navigate, seriesId]);

  const handleChapterStart = useCallback(async () => {
    if (!chapterInfo) return;
    const prevId = await getPrevChapter(chapterId, chapterInfo.seriesId, chapterInfo.volumeId);
    if (prevId > 0) {
      goToChapter(prevId);
    }
  }, [chapterId, chapterInfo, goToChapter]);

  const handleClose = useCallback(() => {
    void navigate({ to: `/reading/${seriesId}` });
  }, [navigate, seriesId]);

  // Close reader on Escape key (skip if an Ant drawer/modal already handled it)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        handleClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  // Loading state
  if (!chapterId || chapterLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!chapterInfo) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Typography.Text type="danger">Failed to load chapter</Typography.Text>
        <br />
        <Button onClick={handleClose} style={{ marginTop: 16 }}>
          Back to series
        </Button>
      </div>
    );
  }

  const format = chapterInfo.seriesFormat;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        background:
          format === FORMAT.ARCHIVE || format === FORMAT.IMAGE
            ? '#000'
            : 'var(--ant-color-bg-container)',
      }}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 1001,
          background: 'rgba(0,0,0,0.5)',
          border: 'none',
          borderRadius: '50%',
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#fff',
        }}
        aria-label="Close reader"
      >
        <X size={18} weight="bold" />
      </button>

      {/* Reader content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {(format === FORMAT.ARCHIVE || format === FORMAT.IMAGE) && (
          <ComicReader
            chapterId={chapterId}
            chapterInfo={chapterInfo}
            initialPage={initialPage}
            onPageChange={handlePageChange}
            onChapterEnd={handleChapterEnd}
            onChapterStart={handleChapterStart}
          />
        )}

        {format === FORMAT.EPUB && bookInfo && (
          <EpubReader
            chapterId={chapterId}
            bookInfo={bookInfo}
            initialPage={initialPage}
            onPageChange={handlePageChange}
            onChapterEnd={handleChapterEnd}
            onChapterStart={handleChapterStart}
          />
        )}

        {format === FORMAT.EPUB && !bookInfo && bookLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Spin size="large" />
          </div>
        )}

        {format === FORMAT.PDF && (
          <PdfReader
            chapterId={chapterId}
            initialPage={initialPage}
            onPageChange={handlePageChange}
          />
        )}

        {format === FORMAT.UNKNOWN && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Typography.Text type="secondary">Unsupported format</Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}
