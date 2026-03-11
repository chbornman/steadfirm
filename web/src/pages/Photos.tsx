import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Select, Typography, Spin, Grid, Image } from 'antd';
import { Heart } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { gridItem as gridItemVariant, colors } from '@steadfirm/theme';
import type { Photo, PhotoListResponse } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { toggleFavorite } from '@/api/photos';
import { useIntersection } from '@/hooks/useIntersection';

const { useBreakpoint } = Grid;

type SortOption = 'dateTaken:desc' | 'dateTaken:asc';

export function PhotosPage() {
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [sort, setSort] = useState<SortOption>('dateTaken:desc');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

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
    queryKey: ['photos', 'list', { sort: sortField, order: sortOrder, favorites: favoritesOnly }],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/photos', {
          searchParams: {
            page: pageParam,
            pageSize: DEFAULT_PAGE_SIZE,
            sort: sortField,
            order: sortOrder,
            ...(favoritesOnly && { favorites: true }),
          },
        })
        .json<PhotoListResponse>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
  });

  const allPhotos = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );

  const totalCount = data?.pages[0]?.total ?? 0;

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const favoriteMutation = useMutation({
    mutationFn: toggleFavorite,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['photos'] });
      // Optimistic update across all pages
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

  // Build album photos for react-photo-album
  const albumPhotos = useMemo(
    () =>
      allPhotos.map((p) => ({
        src: p.thumbnailUrl,
        width: p.width || 400,
        height: p.height || 300,
        key: p.id,
      })),
    [allPhotos],
  );

  const targetRowHeight = isMobile ? 160 : 220;

  // Ref for tracking which photos have been rendered (for stagger)
  const renderedRef = useRef(new Set<string>());

  const renderPhoto = useCallback(
    (
      _props: { onClick?: React.MouseEventHandler },
      {
        photo,
        index,
        width,
        height,
      }: {
        photo: (typeof albumPhotos)[number];
        index: number;
        width: number;
        height: number;
      },
    ) => {
      const sourcePhoto = allPhotos[index];
      if (!sourcePhoto) return null;

      const isNew = !renderedRef.current.has(photo.key);
      if (isNew) renderedRef.current.add(photo.key);

      return (
        <motion.div
          key={photo.key}
          variants={gridItemVariant}
          initial={isNew ? 'hidden' : false}
          whileInView="visible"
          viewport={{ once: true, margin: '-30px' }}
          className="photo-cell"
          style={{
            width,
            height,
            position: 'relative',
            cursor: 'pointer',
            borderRadius: 2,
            overflow: 'hidden',
          }}
          onClick={() => handleSelect(sourcePhoto, index)}
        >
          <img
            src={photo.src}
            alt={sourcePhoto.filename}
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />

          {/* Hover overlay */}
          <div
            className="photo-hover-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 50%)',
              pointerEvents: 'none',
            }}
          />

          {/* Favorite button */}
          <button
            className="photo-fav-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleFavorite(sourcePhoto);
            }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: sourcePhoto.isFavorite ? colors.accentLight : '#fff',
              filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))',
              padding: 4,
              zIndex: 2,
            }}
          >
            <Heart
              size={20}
              weight={sourcePhoto.isFavorite ? 'fill' : 'regular'}
            />
          </button>

          {/* Video badge */}
          {sourcePhoto.type === 'video' && (
            <div
              style={{
                position: 'absolute',
                bottom: 6,
                right: 6,
                background: 'rgba(0,0,0,0.6)',
                borderRadius: '50%',
                width: 26,
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#fff', fontSize: 11 }}>&#9654;</span>
            </div>
          )}
        </motion.div>
      );
    },
    [allPhotos, handleSelect, handleFavorite],
  );

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

      {/* Filter bar */}
      <div
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          background: 'var(--ant-color-bg-layout)',
          borderBottom: '1px solid var(--ant-color-border)',
        }}
      >
        <Select
          value={sort}
          onChange={setSort}
          size="small"
          style={{ width: 160 }}
          options={[
            { value: 'dateTaken:desc', label: 'Newest first' },
            { value: 'dateTaken:asc', label: 'Oldest first' },
          ]}
        />
        <Select
          value={favoritesOnly ? 'favorites' : 'all'}
          onChange={(v) => setFavoritesOnly(v === 'favorites')}
          size="small"
          style={{ width: 130 }}
          options={[
            { value: 'all', label: 'All photos' },
            { value: 'favorites', label: 'Favorites' },
          ]}
        />
        <div style={{ flex: 1 }} />
        {totalCount > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {totalCount.toLocaleString()} photos
          </Typography.Text>
        )}
      </div>

      {/* Photo grid */}
      <div style={{ minHeight: 'calc(100vh - 120px)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allPhotos.length === 0 ? (
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
            <Heart size={64} weight="duotone" />
            <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
              {favoritesOnly ? 'No favorites yet' : 'No photos yet'}
            </Typography.Title>
            <Typography.Text type="secondary">
              Upload your first photos to get started
            </Typography.Text>
          </div>
        ) : (
          <RowsPhotoAlbum
            photos={albumPhotos}
            targetRowHeight={targetRowHeight}
            spacing={4}
            render={{ photo: renderPhoto }}
          />
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} style={{ height: 1 }} />

        {/* Loading indicator for next page */}
        <AnimatePresence>
          {isFetchingNextPage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex', justifyContent: 'center', padding: 24 }}
            >
              <Spin />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
