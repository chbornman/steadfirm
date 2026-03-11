import { Slider, Grid } from 'antd';
import {
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Shuffle,
  Repeat,
  RepeatOnce,
  SpeakerHigh,
  SpeakerSlash,
  Queue,
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { cssVar, ease } from '@steadfirm/theme';
import { formatDuration } from '@steadfirm/shared';
import type { Track } from '@steadfirm/shared';

const { useBreakpoint } = Grid;

export interface MusicPlayerBarState {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
}

export type MusicPlayerBarAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; time: number }
  | { type: 'volume'; value: number }
  | { type: 'toggleMute' }
  | { type: 'toggleShuffle' }
  | { type: 'cycleRepeat' }
  | { type: 'toggleQueue' };

export interface MusicPlayerBarProps {
  state: MusicPlayerBarState;
  onAction: (action: MusicPlayerBarAction) => void;
}

export function MusicPlayerBar({ state, onAction }: MusicPlayerBarProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { currentTrack, isPlaying, currentTime, duration, volume, muted, shuffle, repeat } = state;

  if (!currentTrack) return null;

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
          gap: 16,
          background: 'var(--ant-color-bg-container)',
          borderTop: '1px solid var(--ant-color-border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Left: album art + info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: isMobile ? 1 : '0 0 200px' }}>
          <img
            src={currentTrack.albumImageUrl}
            alt={currentTrack.albumName}
            style={{ width: 44, height: 44, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentTrack.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentTrack.artistName}
            </div>
          </div>
        </div>

        {/* Center: controls + progress */}
        {!isMobile && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <IconButton onClick={() => onAction({ type: 'previous' })}>
                <SkipBack size={18} weight="fill" />
              </IconButton>
              <IconButton
                onClick={() => onAction({ type: isPlaying ? 'pause' : 'play' })}
                accent
              >
                {isPlaying ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" />}
              </IconButton>
              <IconButton onClick={() => onAction({ type: 'next' })}>
                <SkipForward size={18} weight="fill" />
              </IconButton>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 500 }}>
              <span style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
                {formatDuration(currentTime)}
              </span>
              <Slider
                min={0}
                max={duration || 1}
                value={currentTime}
                onChange={(v) => onAction({ type: 'seek', time: v })}
                tooltip={{ formatter: null }}
                style={{ flex: 1, margin: 0 }}
                styles={{ track: { background: cssVar.accent }, handle: { borderColor: cssVar.accent } }}
              />
              <span style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
                {formatDuration(duration)}
              </span>
            </div>
          </div>
        )}

        {/* Mobile: just play/pause */}
        {isMobile && (
          <IconButton
            onClick={() => onAction({ type: isPlaying ? 'pause' : 'play' })}
            accent
          >
            {isPlaying ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
          </IconButton>
        )}

        {/* Right: shuffle, repeat, volume, queue */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 180px', justifyContent: 'flex-end' }}>
            <IconButton
              onClick={() => onAction({ type: 'toggleShuffle' })}
              active={shuffle}
            >
              <Shuffle size={16} />
            </IconButton>
            <IconButton
              onClick={() => onAction({ type: 'cycleRepeat' })}
              active={repeat !== 'off'}
            >
              {repeat === 'one' ? <RepeatOnce size={16} /> : <Repeat size={16} />}
            </IconButton>
            <IconButton onClick={() => onAction({ type: 'toggleMute' })}>
              {muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}
            </IconButton>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(v) => onAction({ type: 'volume', value: v })}
              style={{ width: 60, margin: 0 }}
              tooltip={{ formatter: null }}
              styles={{ track: { background: cssVar.accent }, handle: { borderColor: cssVar.accent } }}
            />
            <IconButton onClick={() => onAction({ type: 'toggleQueue' })}>
              <Queue size={16} />
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
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: accent
          ? cssVar.accent
          : active
            ? cssVar.accentHover
            : 'var(--ant-color-text-secondary)',
        borderRadius: 4,
      }}
    >
      {children}
    </button>
  );
}
