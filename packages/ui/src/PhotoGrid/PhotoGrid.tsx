import { useCallback } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { motion } from 'framer-motion';
import { Heart, Play } from '@phosphor-icons/react';
import { gridContainer, gridItem as gridItemVariant, overlay, cssVar } from '@steadfirm/theme';
import type { Photo } from '@steadfirm/shared';

export interface PhotoGridProps {
  photos: Photo[];
  onSelect: (photo: Photo, index: number) => void;
  onFavorite?: (photo: Photo) => void;
  targetRowHeight?: number;
}

export function PhotoGrid({
  photos,
  onSelect,
  onFavorite,
  targetRowHeight = 220,
}: PhotoGridProps) {
  const albumPhotos = photos.map((p) => ({
    src: p.thumbnailUrl,
    width: p.width,
    height: p.height,
    key: p.id,
  }));

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
      const sourcePhoto = photos[index];
      if (!sourcePhoto) return null;

      return (
        <motion.div
          key={photo.key}
          variants={gridItemVariant}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          style={{
            width,
            height,
            position: 'relative',
            cursor: 'pointer',
            borderRadius: 2,
            overflow: 'hidden',
          }}
          onClick={() => onSelect(sourcePhoto, index)}
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
              transition: 'filter 150ms ease-out',
            }}
          />

          {/* Hover overlay */}
          <div
            className="photo-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0,
              transition: 'opacity 150ms ease-out',
              background: overlay.photoGradientSubtle,
            }}
          >
            {onFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFavorite(sourcePhoto);
                }}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: sourcePhoto.isFavorite ? cssVar.accent : overlay.text,
                  filter: overlay.iconShadow,
                  padding: 4,
                }}
              >
                <Heart
                  size={22}
                  weight={sourcePhoto.isFavorite ? 'fill' : 'regular'}
                />
              </button>
            )}
          </div>

          {/* Video badge */}
          {sourcePhoto.type === 'video' && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                background: overlay.scrimHeavy,
                borderRadius: '50%',
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Play size={14} weight="fill" color={overlay.text} />
            </div>
          )}

          <style>{`
            .photo-overlay { opacity: 0; }
            div:hover > .photo-overlay { opacity: 1; }
          `}</style>
        </motion.div>
      );
    },
    [photos, onSelect, onFavorite],
  );

  return (
    <motion.div variants={gridContainer} initial="hidden" animate="visible">
      <RowsPhotoAlbum
        photos={albumPhotos}
        targetRowHeight={targetRowHeight}
        spacing={4}
        render={{ photo: renderPhoto }}
      />
    </motion.div>
  );
}
