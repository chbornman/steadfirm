import { Slider, Grid } from 'antd';
import {
  Rewind,
  FastForward,
  Play,
  Pause,
  ListBullets,
  BookmarkSimple,
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, ease } from '@steadfirm/theme';
import { formatDuration } from '@steadfirm/shared';

const { useBreakpoint } = Grid;

export interface AudiobookPlayerBarState {
  book: { title: string; coverUrl: string } | null;
  chapterName: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
}

export type AudiobookPlayerBarAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'skipForward' }
  | { type: 'skipBack' }
  | { type: 'cycleSpeed' }
  | { type: 'toggleChapters' }
  | { type: 'seek'; time: number };

export interface AudiobookPlayerBarProps {
  state: AudiobookPlayerBarState;
  onAction: (action: AudiobookPlayerBarAction) => void;
}

export function AudiobookPlayerBar({ state, onAction }: AudiobookPlayerBarProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { book, chapterName, isPlaying, currentTime, duration, speed } = state;

  if (!book) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 64 }}
        animate={{ y: 0 }}
        exit={{ y: 64 }}
        transition={ease.spring}
        style={{
          position: 'fixed',
          bottom: isMobile ? 56 : 0,
          left: 0,
          right: 0,
          height: 64,
          zIndex: 99,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          background: 'var(--ant-color-bg-container)',
          borderTop: '1px solid var(--ant-color-border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Cover art + info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            flex: isMobile ? 1 : '0 0 200px',
          }}
        >
          <img
            src={book.coverUrl}
            alt={book.title}
            style={{
              width: 44,
              height: 44,
              borderRadius: 4,
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {book.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ant-color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {chapterName}
            </div>
          </div>
        </div>

        {/* Center: controls + progress */}
        {!isMobile && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <IconButton onClick={() => onAction({ type: 'skipBack' })}>
                <Rewind size={18} weight="fill" />
              </IconButton>
              <IconButton
                onClick={() => onAction({ type: isPlaying ? 'pause' : 'play' })}
                accent
              >
                {isPlaying ? (
                  <Pause size={22} weight="fill" />
                ) : (
                  <Play size={22} weight="fill" />
                )}
              </IconButton>
              <IconButton onClick={() => onAction({ type: 'skipForward' })}>
                <FastForward size={18} weight="fill" />
              </IconButton>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                maxWidth: 500,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ant-color-text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 36,
                  textAlign: 'right',
                }}
              >
                {formatDuration(currentTime)}
              </span>
              <Slider
                min={0}
                max={duration || 1}
                value={currentTime}
                onChange={(v) => onAction({ type: 'seek', time: v })}
                tooltip={{ formatter: null }}
                style={{ flex: 1, margin: 0 }}
                styles={{
                  track: { background: colors.accent },
                  handle: { borderColor: colors.accent },
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ant-color-text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 36,
                }}
              >
                {formatDuration(duration)}
              </span>
            </div>
          </div>
        )}

        {/* Mobile: play/pause only */}
        {isMobile && (
          <IconButton
            onClick={() => onAction({ type: isPlaying ? 'pause' : 'play' })}
            accent
          >
            {isPlaying ? (
              <Pause size={20} weight="fill" />
            ) : (
              <Play size={20} weight="fill" />
            )}
          </IconButton>
        )}

        {/* Right: speed, chapters, bookmark */}
        {!isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: '0 0 140px',
              justifyContent: 'flex-end',
            }}
          >
            <button
              onClick={() => onAction({ type: 'cycleSpeed' })}
              style={{
                background: 'none',
                border: '1px solid var(--ant-color-border)',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                color: 'var(--ant-color-text)',
                minWidth: 36,
              }}
            >
              {speed}x
            </button>
            <IconButton onClick={() => onAction({ type: 'toggleChapters' })}>
              <ListBullets size={16} />
            </IconButton>
            <IconButton onClick={() => {}}>
              <BookmarkSimple size={16} />
            </IconButton>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function IconButton({
  children,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: accent ? colors.accent : 'var(--ant-color-text-secondary)',
        borderRadius: 4,
      }}
    >
      {children}
    </button>
  );
}
