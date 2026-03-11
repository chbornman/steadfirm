import { useRef, useState, useCallback, useEffect } from 'react';
import { Slider } from 'antd';
import {
  Play,
  Pause,
  SpeakerHigh,
  SpeakerLow,
  SpeakerSlash,
  CornersOut,
} from '@phosphor-icons/react';
import { overlay, cssVar } from '@steadfirm/theme';
import { formatDuration } from '@steadfirm/shared';
import { MediaPlayer, MediaProvider, useMediaState, useMediaRemote } from '@vidstack/react';
import type { MediaPlayerInstance } from '@vidstack/react';

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  onClose?: () => void;
}

/**
 * Inner component that must render inside <MediaPlayer> so the
 * context-based hooks (useMediaState, useMediaRemote) resolve correctly.
 */
function VideoPlayerControls({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [localVolume, setLocalVolume] = useState(1);

  const paused = useMediaState('paused');
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const muted = useMediaState('muted');
  const buffered = useMediaState('bufferedEnd');

  const remote = useMediaRemote();

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!paused) setShowControls(false);
    }, 3000);
  }, [paused]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Show controls when paused
  useEffect(() => {
    if (paused) {
      setShowControls(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }
  }, [paused]);

  const togglePlay = () => {
    if (paused) {
      remote.play();
    } else {
      remote.pause();
    }
    resetHideTimer();
  };

  const handleSeek = (value: number) => {
    remote.seek(value);
  };

  const handleVolume = (value: number) => {
    remote.changeVolume(value);
    setLocalVolume(value);
    if (value === 0) {
      remote.mute();
    } else if (muted) {
      remote.unmute();
    }
  };

  const toggleMute = () => {
    if (muted) {
      remote.unmute();
    } else {
      remote.mute();
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current.requestFullscreen();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'f':
        toggleFullscreen();
        break;
      case 'ArrowLeft':
        remote.seek(Math.max(0, currentTime - 10));
        break;
      case 'ArrowRight':
        remote.seek(Math.min(duration, currentTime + 10));
        break;
      case 'm':
        toggleMute();
        break;
    }
  };

  const VolumeIcon =
    muted || localVolume === 0
      ? SpeakerSlash
      : localVolume < 0.5
        ? SpeakerLow
        : SpeakerHigh;

  const bufferPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <>
      {/* Click-to-toggle overlay */}
      <div
        onClick={togglePlay}
        onMouseMove={resetHideTimer}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          cursor: 'pointer',
          outline: 'none',
        }}
      />

      {/* Controls overlay */}
      <div
        onMouseMove={resetHideTimer}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          background: overlay.controlGradient,
          padding: '24px 12px 12px',
          opacity: showControls ? 1 : 0,
          transition: 'opacity 200ms ease',
          pointerEvents: showControls ? 'auto' : 'none',
        }}
      >
        {/* Progress bar with buffer indicator */}
        <div style={{ position: 'relative', margin: '0 0 8px 0' }}>
          {/* Buffer bar (behind the slider) */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              height: 4,
              width: `${bufferPercent}%`,
              background: overlay.buffer,
              borderRadius: 2,
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <Slider
            min={0}
            max={duration || 1}
            value={currentTime}
            onChange={handleSeek}
            tooltip={{ formatter: (v) => (v != null ? formatDuration(v) : '') }}
            styles={{
              track: { background: cssVar.accent },
              handle: { borderColor: cssVar.accent },
            }}
            style={{ margin: 0, position: 'relative', zIndex: 1 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: overlay.text,
              padding: 4,
            }}
          >
            {paused ? <Play size={22} weight="fill" /> : <Pause size={22} weight="fill" />}
          </button>

          {/* Time */}
          <span style={{ color: overlay.text, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          <div style={{ flex: 1 }} />

          {/* Volume */}
          <button
            onClick={toggleMute}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: overlay.text,
              padding: 4,
            }}
          >
            <VolumeIcon size={18} />
          </button>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : localVolume}
            onChange={handleVolume}
            style={{ width: 80 }}
            styles={{
              track: { background: cssVar.accent },
              handle: { borderColor: cssVar.accent },
            }}
          />

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: overlay.text,
              padding: 4,
            }}
          >
            <CornersOut size={18} />
          </button>
        </div>
      </div>
    </>
  );
}

export function VideoPlayer({ src, poster }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        background: overlay.bg,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <MediaPlayer
        src={src}
        poster={poster}
        crossOrigin=""
        style={{ width: '100%', height: '100%' }}
      >
        <MediaProvider style={{ width: '100%', height: '100%' }} />
        <VideoPlayerControls containerRef={containerRef} />
      </MediaPlayer>
    </div>
  );
}
