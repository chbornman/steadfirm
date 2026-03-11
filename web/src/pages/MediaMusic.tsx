import { useEffect, useMemo, useCallback } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Typography, Spin } from 'antd';
import { MusicNote } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { gridContainer, gridItem as gridItemVariant } from '@steadfirm/theme';
import type { Artist, PaginatedResponse } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { useIntersection } from '@/hooks/useIntersection';
import { useNavigate } from '@tanstack/react-router';
import { MediaSubNav } from './MediaSubNav';

export function MediaMusicPage() {
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
    queryKey: ['media', 'music', 'artists', 'list'],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/media/music/artists', {
          searchParams: { page: pageParam, pageSize: DEFAULT_PAGE_SIZE },
        })
        .json<PaginatedResponse<Artist>>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
  });

  const allArtists = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleSelect = useCallback(
    (artist: Artist) => {
      void navigate({ to: '/media/music/$artistId', params: { artistId: artist.id } });
    },
    [navigate],
  );

  return (
    <>
      <MediaSubNav />

      <div style={{ padding: '12px 16px', minHeight: 'calc(100vh - 160px)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allArtists.length === 0 ? (
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
            <MusicNote size={64} weight="duotone" />
            <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
              No music yet
            </Typography.Title>
          </div>
        ) : (
          <motion.div
            variants={gridContainer}
            initial="hidden"
            animate="visible"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '24px 16px',
            }}
          >
            {allArtists.map((artist) => (
              <motion.div
                key={artist.id}
                variants={gridItemVariant}
                className="artist-cell"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
                onClick={() => handleSelect(artist)}
              >
                <div
                  style={{
                    width: '100%',
                    maxWidth: 160,
                    aspectRatio: '1',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    background: 'var(--ant-color-bg-container)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {artist.imageUrl ? (
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      loading="lazy"
                      className="artist-image"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <MusicNote size={40} weight="duotone" color="var(--ant-color-text-quaternary)" />
                  )}
                </div>
                <div
                  className="artist-name"
                  style={{
                    marginTop: 10,
                    fontSize: 13,
                    fontWeight: 500,
                    textAlign: 'center',
                    color: 'var(--ant-color-text-secondary)',
                    transition: 'color 150ms ease',
                  }}
                >
                  {artist.name}
                </div>
              </motion.div>
            ))}
          </motion.div>
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

      <style>{`
        .artist-image {
          transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .artist-cell:hover .artist-image {
          transform: scale(1.05);
        }
        .artist-cell:hover .artist-name {
          color: var(--ant-color-text);
        }
      `}</style>
    </>
  );
}
