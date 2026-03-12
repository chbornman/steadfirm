import { useState, type CSSProperties } from 'react';
import { BookOpen } from '@phosphor-icons/react';

export interface CoverImageProps {
  src: string;
  alt: string;
  style?: CSSProperties;
  /** Icon size for the placeholder fallback. Defaults to 40. */
  iconSize?: number;
}

/**
 * Image with a graceful fallback for missing covers (404, broken URLs).
 * Shows a tinted placeholder with a book icon and the alt text.
 */
export function CoverImage({ src, alt, style, iconSize = 40 }: CoverImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'var(--ant-color-fill-tertiary)',
          color: 'var(--ant-color-text-secondary)',
          ...style,
        }}
      >
        <BookOpen size={iconSize} weight="duotone" />
        {alt && (
          <span
            style={{
              fontSize: Math.max(10, iconSize / 4),
              fontWeight: 500,
              textAlign: 'center',
              padding: '0 8px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.3,
              maxWidth: '100%',
            }}
          >
            {alt}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={style}
    />
  );
}
