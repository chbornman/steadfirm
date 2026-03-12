import { useCallback } from 'react';
import { Spin } from 'antd';
import { MusicNote } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { gridContainer, gridItem as gridItemVariant } from '@steadfirm/theme';
import type { Artist } from '@steadfirm/shared';
import { useNavigate } from '@tanstack/react-router';
import { ContentPage, useContentList } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';

export function MediaMusicPage() {
  const navigate = useNavigate();

  const { items: allArtists, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Artist>({
      queryKey: ['media', 'music', 'artists', 'list'],
      endpoint: 'api/v1/media/music/artists',
    });

  const handleSelect = useCallback(
    (artist: Artist) => {
      void navigate({ to: '/music/$artistId', params: { artistId: artist.id } });
    },
    [navigate],
  );

  return (
    <>
      <ContentPage
        sentinelRef={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
      >
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allArtists.length === 0 ? (
          <EmptyState
            icon={<MusicNote size={64} weight="duotone" />}
            title="No music yet"
          />
        ) : (
          <motion.div
            variants={gridContainer}
            initial="hidden"
            animate="visible"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '24px 16px',
              paddingTop: 12,
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
      </ContentPage>

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
