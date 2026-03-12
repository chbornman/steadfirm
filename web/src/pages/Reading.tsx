import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Typography, Spin, Grid, Segmented } from 'antd';
import { BookOpenText, Books } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { PosterGrid } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import { overlay } from '@steadfirm/theme';
import type { SeriesListResponse } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { readingQueries } from '@/api/reading';
import type { ReadingLibrary } from '@/api/reading';
import { useIntersection } from '@/hooks/useIntersection';

const { useBreakpoint } = Grid;

export function ReadingPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [activeLibrary, setActiveLibrary] = useState<string | undefined>(
    undefined,
  );

  // Fetch available libraries (Books, Comics, etc.)
  const { data: libraries } = useQuery(readingQueries.libraries());

  // Default to the first library once loaded
  useEffect(() => {
    const first = libraries?.[0];
    if (first && activeLibrary === undefined) {
      setActiveLibrary(first.name);
    }
  }, [libraries, activeLibrary]);

  const { ref: sentinelRef, isIntersecting } = useIntersection({
    rootMargin: '200% 0px',
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['reading', 'list', activeLibrary],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/reading', {
          searchParams: {
            page: pageParam,
            pageSize: DEFAULT_PAGE_SIZE,
            ...(activeLibrary != null && { library: activeLibrary }),
          },
        })
        .json<SeriesListResponse>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
    enabled: activeLibrary !== undefined,
  });

  const allSeries = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const inProgress = useMemo(
    () => allSeries.filter((s) => s.pagesRead > 0 && s.pagesRead < s.pages),
    [allSeries],
  );

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const posterItems: PosterGridItem[] = useMemo(
    () =>
      allSeries.map((s) => ({
        id: s.id,
        imageUrl: s.coverUrl,
        title: s.name,
        subtitle: s.format,
      })),
    [allSeries],
  );

  const handleSelect = (item: PosterGridItem) => {
    window.location.href = `/reading/${item.id}`;
  };

  const showTabs = libraries && libraries.length > 1;

  return (
    <div style={{ minHeight: 'calc(100vh - 120px)' }}>
      {/* Library tabs */}
      {showTabs && (
        <div style={{ padding: '16px 16px 0' }}>
          <Segmented
            value={activeLibrary}
            onChange={(val) => setActiveLibrary(val)}
            options={libraries.map((lib: ReadingLibrary) => ({
              label: lib.name,
              value: lib.name,
            }))}
            block={isMobile}
          />
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : allSeries.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 'calc(100vh - 200px)',
            color: 'var(--ant-color-text-secondary)',
          }}
        >
          <BookOpenText size={64} weight="duotone" />
          <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
            No {activeLibrary?.toLowerCase() ?? 'items'} yet
          </Typography.Title>
          <Typography.Text type="secondary">
            Upload your first ebook or comic to get started
          </Typography.Text>
        </div>
      ) : (
        <>
          {/* Continue Reading */}
          {inProgress.length > 0 && (
            <div style={{ padding: '24px 16px 8px' }}>
              <Typography.Title level={5} style={{ margin: '0 0 12px' }}>
                Continue Reading
              </Typography.Title>
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  overflowX: 'auto',
                  paddingBottom: 8,
                  scrollbarWidth: 'thin',
                }}
              >
                <AnimatePresence>
                  {inProgress.map((series) => (
                    <ContinueCard key={series.id} series={series} isMobile={isMobile} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Full library */}
          <div style={{ padding: '16px 8px' }}>
            <Typography.Title level={5} style={{ margin: '0 0 12px', padding: '0 8px' }}>
              {activeLibrary ?? 'Library'}
            </Typography.Title>
            <PosterGrid
              items={posterItems}
              onSelect={handleSelect}
              aspectRatio="2 / 3"
              hoverIcon={
                activeLibrary === 'Comics' ? (
                  <Books size={40} weight="fill" color={overlay.text} />
                ) : (
                  <BookOpenText size={40} weight="fill" color={overlay.text} />
                )
              }
            />
          </div>
        </>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      <AnimatePresence>
        {isFetchingNextPage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ display: 'flex', justifyContent: 'center', padding: 24 }}
          >
            <Spin />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ContinueCard({
  series,
  isMobile,
}: {
  series: { id: string; name: string; coverUrl: string; pages: number; pagesRead: number };
  isMobile: boolean;
}) {
  const progress = series.pages > 0 ? series.pagesRead / series.pages : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => {
        window.location.href = `/reading/${series.id}`;
      }}
      style={{
        flexShrink: 0,
        width: isMobile ? 140 : 160,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '2 / 3',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--ant-color-bg-container)',
        }}
      >
        <img
          src={series.coverUrl}
          alt={series.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        {/* Progress bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: 'var(--ant-color-primary)',
              borderRadius: '0 2px 2px 0',
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: 6, padding: '0 2px' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {series.name}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ant-color-text-secondary)',
            marginTop: 2,
          }}
        >
          {Math.round(progress * 100)}% complete
        </div>
      </div>
    </motion.div>
  );
}
