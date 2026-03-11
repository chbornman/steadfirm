import { useCallback } from 'react';
import { motion } from 'framer-motion';
import { Heart, Play } from '@phosphor-icons/react';
import { gridContainer, gridItem as gridItemVariant, overlay, cssVar } from '@steadfirm/theme';
import type { Photo } from '@steadfirm/shared';

export interface PhotoGridProps {
  photos: Photo[];
  onSelect: (photo: Photo, index: number) => void;
  onFavorite?: (photo: Photo) => void;
}

export function PhotoGrid({ photos, onSelect, onFavorite }: PhotoGridProps) {
  const renderItem = useCallback(
    (photo: Photo, index: number) => (
      <motion.div
        key={photo.id}
        variants={gridItemVariant}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-50px' }}
        style={{
          position: 'relative',
          cursor: 'pointer',
          borderRadius: 2,
          overflow: 'hidden',
          aspectRatio: '1 / 1',
        }}
        onClick={() => onSelect(photo, index)}
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
                onFavorite(photo);
              }}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: photo.isFavorite ? cssVar.accent : overlay.text,
                filter: overlay.iconShadow,
                padding: 4,
              }}
            >
              <Heart
                size={22}
                weight={photo.isFavorite ? 'fill' : 'regular'}
              />
            </button>
          )}
        </div>

        {/* Video badge */}
        {photo.type === 'video' && (
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
    ),
    [onSelect, onFavorite],
  );

  return (
    <motion.div
      variants={gridContainer}
      initial="hidden"
      animate="visible"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 4,
      }}
    >
      {photos.map((photo, index) => renderItem(photo, index))}
    </motion.div>
  );
}
