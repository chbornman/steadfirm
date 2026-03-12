import { useRef, useState, useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { Grid } from 'antd';
import {
  Rewind,
  FastForward,
  Play,
  Pause,
  ListBullets,
  X,
  SpeakerHigh,
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { cssVar, ease } from '@steadfirm/theme';
import { formatDuration } from '@steadfirm/shared';
import { CoverImage } from '../CoverImage';

const { useBreakpoint } = Grid;

// ─── Types ───────────────────────────────────────────────────────────

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
  | { type: 'setSpeed'; speed: number }
  | { type: 'toggleChapters' }
  | { type: 'seek'; time: number }
  | { type: 'close' };

export interface AudiobookPlayerBarProps {
  state: AudiobookPlayerBarState;
  onAction: (action: AudiobookPlayerBarAction) => void;
}

// ─── Speed presets ───────────────────────────────────────────────────

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// ─── Card dimensions ─────────────────────────────────────────────────

const CARD_WIDTH = 320;
const CARD_MARGIN = 16;
const ARTWORK_SIZE = CARD_WIDTH - 32; // 16px padding each side
const SCRUB_HEIGHT = 4;
const SCRUB_HEIGHT_HOVER = 6;

// ─── Component ───────────────────────────────────────────────────────

export function AudiobookPlayerBar({ state, onAction }: AudiobookPlayerBarProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { book, chapterName, isPlaying, currentTime, duration, speed } = state;

  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);

  // Close speed popover on outside click
  useEffect(() => {
    if (!speedOpen) return;
    const handler = (e: MouseEvent) => {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [speedOpen]);

  if (!book) return null;

  const progress = duration > 0 ? currentTime / duration : 0;

  // ─── Mobile: compact bottom bar ──────────────────────────────────

  if (isMobile) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ y: 80 }}
          animate={{ y: 0 }}
          exit={{ y: 80 }}
          transition={ease.spring}
          style={{
            position: 'fixed',
            bottom: 56,
            left: 8,
            right: 8,
            zIndex: 99,
            borderRadius: 14,
            background: 'var(--ant-color-bg-container)',
            border: '1px solid var(--ant-color-border)',
            boxShadow: 'var(--sf-shadow-elevated)',
            overflow: 'hidden',
          }}
        >
          {/* Thin progress bar at top of mobile card */}
          <div style={{ height: 3, background: 'var(--ant-color-fill-tertiary)' }}>
            <div
              style={{
                height: '100%',
                width: `${progress * 100}%`,
                background: cssVar.accent,
                transition: 'width 0.3s linear',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
            }}
          >
            <CoverImage
              src={book.coverUrl}
              alt={book.title}
              iconSize={18}
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                objectFit: 'cover',
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {book.title}
              </div>
              <div style={{
                fontSize: 11,
                color: 'var(--ant-color-text-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {chapterName}
              </div>
            </div>
            <IconButton onClick={() => onAction({ type: isPlaying ? 'pause' : 'play' })} size={36} accent>
              {isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
            </IconButton>
            <IconButton onClick={() => onAction({ type: 'close' })} size={28}>
              <X size={14} weight="bold" />
            </IconButton>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ─── Desktop: floating card ──────────────────────────────────────

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 40, opacity: 0, scale: 0.95 }}
        transition={ease.spring}
        style={{
          position: 'fixed',
          bottom: CARD_MARGIN,
          right: CARD_MARGIN,
          width: CARD_WIDTH,
          zIndex: 99,
          borderRadius: 16,
          background: 'var(--ant-color-bg-container)',
          border: '1px solid var(--ant-color-border)',
          boxShadow: 'var(--sf-shadow-elevated)',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        {/* Close button */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
          <IconButton
            onClick={() => onAction({ type: 'close' })}
            size={28}
            style={{
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
            }}
          >
            <X size={14} weight="bold" />
          </IconButton>
        </div>

        {/* Large artwork */}
        <div style={{ padding: 16, paddingBottom: 0 }}>
          <CoverImage
            src={book.coverUrl}
            alt={book.title}
            iconSize={48}
            style={{
              width: ARTWORK_SIZE,
              height: ARTWORK_SIZE,
              borderRadius: 12,
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>

        {/* Info */}
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {book.title}
          </div>
          <div style={{
            fontSize: 12,
            color: 'var(--ant-color-text-tertiary)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {chapterName}
          </div>
        </div>

        {/* Scrub bar */}
        <div style={{ padding: '12px 16px 0' }}>
          <ScrubBar
            currentTime={currentTime}
            duration={duration}
            onSeek={(time) => onAction({ type: 'seek', time })}
          />
        </div>

        {/* Transport controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            padding: '12px 16px',
          }}
        >
          <IconButton onClick={() => onAction({ type: 'skipBack' })} size={36}>
            <Rewind size={20} weight="fill" />
          </IconButton>
          <IconButton
            onClick={() => onAction({ type: isPlaying ? 'pause' : 'play' })}
            size={44}
            accent
            style={{
              background: cssVar.accent,
              color: '#fff',
              borderRadius: '50%',
            }}
          >
            {isPlaying ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
          </IconButton>
          <IconButton onClick={() => onAction({ type: 'skipForward' })} size={36}>
            <FastForward size={20} weight="fill" />
          </IconButton>
        </div>

        {/* Bottom toolbar: speed + chapters */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px 14px',
          }}
        >
          {/* Speed control */}
          <div ref={speedRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setSpeedOpen((o) => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: speedOpen ? 'var(--ant-color-fill-secondary)' : 'var(--ant-color-fill-quaternary)',
                border: 'none',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                color: speed !== 1 ? cssVar.accent : 'var(--ant-color-text-secondary)',
                fontFamily: 'inherit',
                transition: 'background 150ms ease, color 150ms ease',
              }}
            >
              <SpeakerHigh size={13} weight="bold" />
              {speed}x
            </button>

            {/* Speed popover */}
            <AnimatePresence>
              {speedOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: 6,
                    background: 'var(--ant-color-bg-elevated)',
                    border: '1px solid var(--ant-color-border)',
                    borderRadius: 10,
                    boxShadow: 'var(--sf-shadow-elevated)',
                    padding: 6,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 2,
                    minWidth: 150,
                    zIndex: 10,
                  }}
                >
                  {SPEED_PRESETS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        onAction({ type: 'setSpeed', speed: s });
                        setSpeedOpen(false);
                      }}
                      style={{
                        background: s === speed ? cssVar.accent : 'transparent',
                        color: s === speed ? '#fff' : 'var(--ant-color-text)',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 4px',
                        fontSize: 12,
                        fontWeight: s === speed ? 600 : 400,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'background 100ms ease',
                      }}
                    >
                      {s}x
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Chapters button */}
          <IconButton onClick={() => onAction({ type: 'toggleChapters' })} size={32}>
            <ListBullets size={16} />
          </IconButton>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── ScrubBar ────────────────────────────────────────────────────────

interface ScrubBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

function ScrubBar({ currentTime, duration, onSeek }: ScrubBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);

  const timeToShow = scrubTime ?? currentTime;
  const progress = duration > 0 ? timeToShow / duration : 0;

  const getTimeFromPointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current || duration <= 0) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setScrubbing(true);
      const time = getTimeFromPointer(e.clientX);
      setScrubTime(time);
    },
    [getTimeFromPointer],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!scrubbing) return;
      const time = getTimeFromPointer(e.clientX);
      setScrubTime(time);
    },
    [scrubbing, getTimeFromPointer],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!scrubbing) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setScrubbing(false);
      const time = getTimeFromPointer(e.clientX);
      onSeek(time);
      setScrubTime(null);
    },
    [scrubbing, getTimeFromPointer, onSeek],
  );

  const barHeight = hovered || scrubbing ? SCRUB_HEIGHT_HOVER : SCRUB_HEIGHT;

  return (
    <div>
      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          height: 16,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          touchAction: 'none',
        }}
      >
        {/* Background track */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: barHeight,
            borderRadius: barHeight / 2,
            background: 'var(--ant-color-fill-tertiary)',
            transition: 'height 150ms ease',
          }}
        />
        {/* Filled track */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${progress * 100}%`,
            height: barHeight,
            borderRadius: barHeight / 2,
            background: cssVar.accent,
            transition: scrubbing ? undefined : 'width 0.3s linear, height 150ms ease',
          }}
        />
        {/* Thumb */}
        <div
          style={{
            position: 'absolute',
            left: `${progress * 100}%`,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: cssVar.accent,
            transform: 'translate(-50%, 0)',
            opacity: hovered || scrubbing ? 1 : 0,
            transition: 'opacity 150ms ease',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
          }}
        />
      </div>

      {/* Time labels */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 2,
        }}
      >
        <span style={timeLabelStyle}>{formatDuration(timeToShow)}</span>
        <span style={timeLabelStyle}>-{formatDuration(Math.max(0, duration - timeToShow))}</span>
      </div>
    </div>
  );
}

const timeLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--ant-color-text-quaternary)',
  fontVariantNumeric: 'tabular-nums',
};

// ─── IconButton ──────────────────────────────────────────────────────

function IconButton({
  children,
  onClick,
  accent,
  size = 32,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: size,
        height: size,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: accent ? cssVar.accent : 'var(--ant-color-text-secondary)',
        borderRadius: 8,
        flexShrink: 0,
        transition: 'background 100ms ease',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
