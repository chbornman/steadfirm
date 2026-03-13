import { X } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { formatDuration } from '@steadfirm/shared';
import type { Track } from '@steadfirm/shared';

export interface MusicQueueProps {
  queue: Track[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
}

export function MusicQueue({ queue, currentIndex, onSelect, onRemove }: MusicQueueProps) {
  return (
    <div style={{ padding: '8px 0' }}>
      {queue.map((track, index) => {
        const isCurrent = index === currentIndex;
        return (
          <div
            key={`${track.id}-${index}`}
            onClick={() => onSelect(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 16px',
              cursor: 'pointer',
              borderLeft: isCurrent ? `3px solid ${cssVar.accent}` : '3px solid transparent',
              background: isCurrent ? 'var(--ant-color-bg-container)' : 'transparent',
              transition: 'background 100ms ease',
            }}
          >
            {track.albumImageUrl ? (
              <img
                src={track.albumImageUrl}
                alt={track.albumName ?? track.title}
                style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: 4, flexShrink: 0, background: 'var(--ant-color-fill-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 16, opacity: 0.4 }}>&#9835;</span>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: isCurrent ? 600 : 400,
                  color: isCurrent ? cssVar.accent : 'var(--ant-color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {track.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>
                {track.artistName ?? 'Unknown artist'}
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', flexShrink: 0 }}>
              {formatDuration(track.duration)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(index);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--ant-color-text-secondary)',
                opacity: 0.5,
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
