import { useCallback } from 'react';
import { Spin } from 'antd';
import { MusicNote, Microphone, VinylRecord } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { gridContainer, gridItem as gridItemVariant } from '@steadfirm/theme';
import type { Album } from '@steadfirm/shared';
import { useNavigate } from '@tanstack/react-router';
import { ContentPage, NavRail, useContentList } from '@/components/content';
import type { NavRailItem } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';
import { musicNavItems, handleMusicNav } from '@/pages/music-nav';

export function MusicAlbumsPage() {
  const navigate = useNavigate();

  const { items: allAlbums, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Album>({
      queryKey: ['media', 'music', 'albums', 'list'],
      endpoint: 'api/v1/media/music/albums',
    });

  const handleSelect = useCallback(
    (album: Album) => {
      void navigate({ to: '/music/albums/$albumId', params: { albumId: album.id } });
    },
    [navigate],
  );

  const handleNavChange = useCallback(
    (key: string) => handleMusicNav(key, navigate),
    [navigate],
  );

  return (
    <>
      <ContentPage
        sentinelRef={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        navRail={
          <NavRail items={musicNavItems} activeKey="albums" onChange={handleNavChange} />
        }
      >
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allAlbums.length === 0 ? (
          <EmptyState
            icon={<VinylRecord size={64} weight="duotone" />}
            title="No albums yet"
          />
        ) : (
          <motion.div
            variants={gridContainer}
            initial="hidden"
            animate="visible"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '24px 16px',
              paddingTop: 12,
            }}
          >
            {allAlbums.map((album) => (
              <motion.div
                key={album.id}
                variants={gridItemVariant}
                className="album-cell"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                }}
                onClick={() => handleSelect(album)}
              >
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: 'var(--ant-color-bg-container)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {album.imageUrl ? (
                    <img
                      src={album.imageUrl}
                      alt={album.name}
                      loading="lazy"
                      className="album-image"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <VinylRecord size={40} weight="duotone" color="var(--ant-color-text-quaternary)" />
                  )}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {album.name}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ant-color-text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {[album.artistName, album.year].filter(Boolean).join(' \u00b7 ')}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </ContentPage>

      <style>{`
        .album-image {
          transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .album-cell:hover .album-image {
          transform: scale(1.03);
        }
      `}</style>
    </>
  );
}
