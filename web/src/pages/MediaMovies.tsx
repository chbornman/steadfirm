import { useState, useEffect, useMemo, useCallback } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Select, Drawer, Typography, Spin, Button, Grid } from 'antd';
import { Play } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { PosterGrid } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import { VideoPlayer } from '@steadfirm/ui';
import { overlay, cssVar } from '@steadfirm/theme';
import type { Movie, MovieListResponse } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { useIntersection } from '@/hooks/useIntersection';
import { MediaSubNav } from './MediaSubNav';

const { useBreakpoint } = Grid;

type SortOption = 'title:asc' | 'dateAdded:desc' | 'year:desc';

export function MediaMoviesPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [sort, setSort] = useState<SortOption>('title:asc');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);

  const [sortField, sortOrder] = sort.split(':') as [string, string];

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
    queryKey: ['media', 'movies', 'list', { sort: sortField, order: sortOrder }],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/media/movies', {
          searchParams: {
            page: pageParam,
            pageSize: DEFAULT_PAGE_SIZE,
            sort: sortField,
            order: sortOrder,
          },
        })
        .json<MovieListResponse>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
  });

  const allMovies = useMemo(
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
      allMovies.map((m) => ({
        id: m.id,
        imageUrl: m.imageUrl,
        title: m.title,
        subtitle: String(m.year),
      })),
    [allMovies],
  );

  const handleSelect = useCallback(
    (item: PosterGridItem) => {
      const movie = allMovies.find((m) => m.id === item.id);
      if (movie) {
        setSelectedMovie(movie);
        setShowPlayer(false);
      }
    },
    [allMovies],
  );

  return (
    <>
      <MediaSubNav />

      {/* Sort controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
        }}
      >
        <Select
          value={sort}
          onChange={setSort}
          size="small"
          style={{ width: 150 }}
          options={[
            { value: 'title:asc', label: 'Title A-Z' },
            { value: 'dateAdded:desc', label: 'Recently added' },
            { value: 'year:desc', label: 'Year' },
          ]}
        />
      </div>

      {/* Grid */}
      <div style={{ padding: '0 8px', minHeight: 'calc(100vh - 180px)' }}>
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
            <Play size={64} weight="duotone" />
            <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
              No movies yet
            </Typography.Title>
          </div>
        ) : (
          <PosterGrid
            items={posterItems}
            onSelect={handleSelect}
            hoverIcon={<Play size={40} weight="fill" color={overlay.text} />}
          />
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

      {/* Movie detail drawer */}
      <Drawer
        open={selectedMovie !== null}
        onClose={() => setSelectedMovie(null)}
        width={isMobile ? '100%' : 480}
        closable
        title={null}
        styles={{ body: { padding: 0 } }}
      >
        {selectedMovie && (
          <div>
            {/* Player or poster */}
            {showPlayer ? (
              <VideoPlayer
                src={selectedMovie.streamUrl}
                poster={selectedMovie.imageUrl}
              />
            ) : (
              <div style={{ position: 'relative' }}>
                <img
                  src={selectedMovie.imageUrl}
                  alt={selectedMovie.title}
                  style={{
                    width: '100%',
                    aspectRatio: '2 / 3',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </div>
            )}

            <div style={{ padding: 20 }}>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {selectedMovie.title}
              </Typography.Title>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 8,
                  color: 'var(--ant-color-text-secondary)',
                  fontSize: 14,
                }}
              >
                <span>{selectedMovie.year}</span>
                <span>{selectedMovie.runtime} min</span>
                {selectedMovie.rating && <span>{selectedMovie.rating}</span>}
              </div>

              <Typography.Paragraph
                style={{ marginTop: 16 }}
                type="secondary"
              >
                {selectedMovie.overview}
              </Typography.Paragraph>

              {!showPlayer && (
                <Button
                  type="primary"
                  size="large"
                  block
                  icon={<Play size={18} weight="fill" />}
                  onClick={() => setShowPlayer(true)}
                  style={{
                    marginTop: 16,
                    height: 48,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: cssVar.accent,
                  }}
                >
                  Play
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
