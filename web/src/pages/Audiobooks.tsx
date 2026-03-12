import { useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Typography, Spin, Grid } from 'antd';
import { Headphones } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { PosterGrid, CoverImage } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import { gridItem, overlay, cssVar } from '@steadfirm/theme';
import type { AudiobookListResponse, Audiobook } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { useIntersection } from '@/hooks/useIntersection';

const { useBreakpoint } = Grid;

export function AudiobooksPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

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
    queryKey: ['audiobooks', 'list'],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/audiobooks', {
          searchParams: {
            page: pageParam,
            pageSize: DEFAULT_PAGE_SIZE,
          },
        })
        .json<AudiobookListResponse>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
  });

  const allBooks = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const inProgress = useMemo(
    () => allBooks.filter((b) => b.progress != null && b.progress > 0 && b.progress < 1),
    [allBooks],
  );

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const posterItems: PosterGridItem[] = useMemo(
    () =>
      allBooks.map((b) => ({
        id: b.id,
        imageUrl: b.coverUrl,
        title: b.title,
        subtitle: b.author,
      })),
    [allBooks],
  );

  const handleSelect = (item: PosterGridItem) => {
    void navigate({ to: '/audiobooks/$bookId', params: { bookId: item.id } });
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 120px)' }}>
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : allBooks.length === 0 ? (
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
          <Headphones size={64} weight="duotone" />
          <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
            No audiobooks yet
          </Typography.Title>
          <Typography.Text type="secondary">
            Upload your first audiobook to get started
          </Typography.Text>
        </div>
      ) : (
        <>
          {/* Continue Listening */}
          {inProgress.length > 0 && (
            <div style={{ padding: '24px 16px 8px' }}>
              <Typography.Title level={5} style={{ margin: '0 0 12px' }}>
                Continue Listening
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
                  {inProgress.map((book) => (
                    <ContinueCard key={book.id} book={book} isMobile={isMobile} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Full library */}
          <div style={{ padding: '16px 8px' }}>
            <Typography.Title level={5} style={{ margin: '0 0 12px', padding: '0 8px' }}>
              Library
            </Typography.Title>
            <PosterGrid
              items={posterItems}
              onSelect={handleSelect}
              aspectRatio="2 / 3"
              hoverIcon={<Headphones size={40} weight="fill" color={overlay.text} />}
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

function ContinueCard({ book, isMobile }: { book: Audiobook; isMobile: boolean }) {
  const navigate = useNavigate();
  const progress = book.progress ?? 0;

  return (
    <motion.div
      variants={gridItem}
      initial="hidden"
      animate="visible"
      onClick={() => {
        void navigate({ to: '/audiobooks/$bookId', params: { bookId: book.id } });
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
        <CoverImage
          src={book.coverUrl}
          alt={book.title}
          iconSize={32}
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
            background: overlay.scrimLight,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: cssVar.accent,
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
          {book.title}
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
