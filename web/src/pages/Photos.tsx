import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Spin, Grid, Image } from 'antd';
import { Heart } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { gridItem as gridItemVariant, overlay, cssVar } from '@steadfirm/theme';
import type { Photo, PhotoListResponse } from '@steadfirm/shared';
import { toggleFavorite } from '@/api/photos';
import { ContentPage, FilterRail, useContentList } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';

const { useBreakpoint } = Grid;

type SortOption = 'dateTaken:desc' | 'dateTaken:asc';

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'dateTaken:desc', label: 'Newest first' },
  { value: 'dateTaken:asc', label: 'Oldest first' },
];

export function PhotosPage() {
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [sort, setSort] = useState<SortOption>('dateTaken:desc');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const [sortField, sortOrder] = sort.split(':') as [string, string];

  const { items: allPhotos, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Photo>({
      queryKey: ['photos', 'list', { sort: sortField, order: sortOrder, favorites: favoritesOnly }],
      endpoint: 'api/v1/photos',
      params: {
        sort: sortField,
        order: sortOrder,
        ...(favoritesOnly && { favorites: true }),
      },
    });

  const favoriteMutation = useMutation({
    mutationFn: toggleFavorite,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['photos'] });
      queryClient.setQueriesData<{ pages: PhotoListResponse[]; pageParams: number[] }>(
        { queryKey: ['photos', 'list'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((p) =>
                p.id === id ? { ...p, isFavorite: !p.isFavorite } : p,
              ),
            })),
          };
        },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['photos'] });
    },
  });

  const handleSelect = useCallback((_photo: Photo, index: number) => {
    setPreviewIndex(index);
    setPreviewVisible(true);
  }, []);

  const handleFavorite = useCallback(
    (photo: Photo) => {
      favoriteMutation.mutate(photo.id);
    },
    [favoriteMutation],
  );

  const renderedRef = useRef(new Set<string>());

  return (
    <>
      <style>{`
        .photo-cell .photo-hover-overlay,
        .photo-cell .photo-fav-btn { opacity: 0; transition: opacity 150ms ease-out; }
        .photo-cell:hover .photo-hover-overlay,
        .photo-cell:hover .photo-fav-btn { opacity: 1; }
        .photo-cell img { transition: filter 150ms ease-out; }
        .photo-cell:hover img { filter: brightness(1.08); }
      `}</style>

      <ContentPage
        sentinelRef={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        filterRail={
          <FilterRail>
            <FilterRail.Sort value={sort} onChange={setSort} options={sortOptions} />
            <FilterRail.Toggle
              icon={Heart}
              label="Favorites"
              value={favoritesOnly}
              onChange={setFavoritesOnly}
              options={['All photos', 'Favorites only']}
            />
          </FilterRail>
        }
      >
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allPhotos.length === 0 ? (
          <EmptyState
            icon={<Heart size={64} weight="duotone" />}
            title={favoritesOnly ? 'No favorites yet' : 'No photos yet'}
            description="Upload your first photos to get started"
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile
                ? 'repeat(auto-fill, minmax(100px, 1fr))'
                : 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 4,
              paddingTop: 4,
            }}
          >
            {allPhotos.map((photo, index) => {
              const isNew = !renderedRef.current.has(photo.id);
              if (isNew) renderedRef.current.add(photo.id);

              return (
                <motion.div
                  key={photo.id}
                  variants={gridItemVariant}
                  initial={isNew ? 'hidden' : false}
                  whileInView="visible"
                  viewport={{ once: true, margin: '-30px' }}
                  className="photo-cell"
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: 2,
                    overflow: 'hidden',
                    aspectRatio: '1 / 1',
                  }}
                  onClick={() => handleSelect(photo, index)}
                >
                  <img
                    src={photo.thumbnailUrl}
                    alt={photo.filename}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  <div
                    className="photo-hover-overlay"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: overlay.photoGradient,
                      pointerEvents: 'none',
                    }}
                  />
                  <button
                    className="photo-fav-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFavorite(photo);
                    }}
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: photo.isFavorite ? cssVar.accent : overlay.text,
                      filter: overlay.iconShadowStrong,
                      padding: 4,
                      zIndex: 2,
                    }}
                  >
                    <Heart size={20} weight={photo.isFavorite ? 'fill' : 'regular'} />
                  </button>
                  {photo.type === 'video' && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 6,
                        right: 6,
                        background: overlay.scrimHeavy,
                        borderRadius: '50%',
                        width: 26,
                        height: 26,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span style={{ color: overlay.text, fontSize: 11 }}>&#9654;</span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </ContentPage>

      {/* Lightbox via Ant Design Image.PreviewGroup */}
      <div style={{ display: 'none' }}>
        <Image.PreviewGroup
          preview={{
            visible: previewVisible,
            onVisibleChange: setPreviewVisible,
            current: previewIndex,
            onChange: setPreviewIndex,
          }}
        >
          {allPhotos.map((photo) => (
            <Image
              key={photo.id}
              src={`/api/v1/photos/${photo.id}/original`}
              alt={photo.filename}
            />
          ))}
        </Image.PreviewGroup>
      </div>
    </>
  );
}
