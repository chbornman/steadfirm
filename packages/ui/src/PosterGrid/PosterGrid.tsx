import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { gridContainer, gridItem as gridItemVariant, overlay } from '@steadfirm/theme';

export interface PosterGridItem {
  id: string;
  imageUrl: string;
  title: string;
  subtitle?: string;
}

export interface PosterGridProps {
  items: PosterGridItem[];
  onSelect: (item: PosterGridItem) => void;
  aspectRatio?: string;
  hoverIcon?: ReactNode;
  columnWidth?: number;
}

export function PosterGrid({
  items,
  onSelect,
  aspectRatio = '2 / 3',
  hoverIcon,
  columnWidth = 180,
}: PosterGridProps) {
  return (
    <motion.div
      variants={gridContainer}
      initial="hidden"
      animate="visible"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, 1fr))`,
        gap: '16px 8px',
        padding: '0 8px',
      }}
    >
      {items.map((item) => (
        <motion.div
          key={item.id}
          variants={gridItemVariant}
          className="poster-cell"
          style={{ cursor: 'pointer' }}
          onClick={() => onSelect(item)}
        >
          <div
            style={{
              position: 'relative',
              aspectRatio,
              borderRadius: 4,
              overflow: 'hidden',
              background: 'var(--ant-color-bg-container)',
            }}
          >
            <img
              src={item.imageUrl}
              alt={item.title}
              loading="lazy"
              className="poster-image"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />

            {/* Hover overlay */}
            <div
              className="poster-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                background: overlay.posterGradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {hoverIcon}
            </div>
          </div>

          <div style={{ marginTop: 6, padding: '0 2px' }}>
            <div
              className="poster-title"
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--ant-color-text)',
              }}
            >
              {item.title}
            </div>
            {item.subtitle && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ant-color-text-secondary)',
                  marginTop: 2,
                }}
              >
                {item.subtitle}
              </div>
            )}
          </div>
        </motion.div>
      ))}

      <style>{`
        .poster-image {
          transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .poster-cell:hover .poster-image {
          transform: scale(1.05);
        }
        .poster-overlay {
          opacity: 0;
          transition: opacity 150ms ease-out;
        }
        .poster-cell:hover .poster-overlay {
          opacity: 1;
        }
        .poster-cell:hover .poster-title {
          white-space: normal;
        }
      `}</style>
    </motion.div>
  );
}
