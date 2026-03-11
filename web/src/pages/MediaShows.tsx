import { useEffect, useMemo, useCallback } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Typography, Spin } from 'antd';
import { Television } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { PosterGrid } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import type { ShowListResponse } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { useIntersection } from '@/hooks/useIntersection';
import { useNavigate } from '@tanstack/react-router';
import { MediaSubNav } from './MediaSubNav';

export function MediaShowsPage() {
  const navigate = useNavigate();

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
    queryKey: ['media', 'shows', 'list'],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/media/shows', {
          searchParams: { page: pageParam, pageSize: DEFAULT_PAGE_SIZE },
        })
        .json<ShowListResponse>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
  });

  const allShows = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const posterItems: PosterGridItem[] = useMemo(
    () =>
      allShows.map((s) => ({
        id: s.id,
        imageUrl: s.imageUrl,
        title: s.title,
        subtitle: `${s.year} - ${s.seasonCount} season${s.seasonCount !== 1 ? 's' : ''}`,
      })),
    [allShows],
  );

  const handleSelect = useCallback(
    (item: PosterGridItem) => {
      void navigate({ to: '/media/shows/$showId', params: { showId: item.id } });
    },
    [navigate],
  );

  return (
    <>
      <MediaSubNav />

      <div style={{ padding: '12px 8px', minHeight: 'calc(100vh - 160px)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : posterItems.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 'calc(100vh - 250px)',
              color: 'var(--ant-color-text-secondary)',
            }}
          >
            <Television size={64} weight="duotone" />
            <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
              No TV shows yet
            </Typography.Title>
          </div>
        ) : (
          <PosterGrid items={posterItems} onSelect={handleSelect} />
        )}

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
    </>
  );
}
