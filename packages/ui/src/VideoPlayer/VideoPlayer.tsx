import { useRef, useState, useEffect, useCallback } from 'react';
import { Slider } from 'antd';
import {
  Play,
  Pause,
  SpeakerHigh,
  SpeakerSlash,
  CornersOut,
} from '@phosphor-icons/react';
import { colors } from '@steadfirm/theme';
import { formatDuration } from '@steadfirm/shared';

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  onClose?: () => void;
}

export function VideoPlayer({ src, poster }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const video = videoRef.current;

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  }, [playing]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const togglePlay = () => {
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
    resetHideTimer();
  };

  const handleTimeUpdate = () => {
    if (video) setCurrentTime(video.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (video) setDuration(video.duration);
  };

  const handleSeek = (value: number) => {
    if (video) {
      video.currentTime = value;
      setCurrentTime(value);
    }
  };

  const handleVolume = (value: number) => {
    if (video) {
      video.volume = value;
      setVolume(value);
      setMuted(value === 0);
    }
  };

  const toggleMute = () => {
    if (!video) return;
    const newMuted = !muted;
    video.muted = newMuted;
    setMuted(newMuted);
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
        if (video) handleSeek(Math.max(0, video.currentTime - 10));
        break;
      case 'ArrowRight':
        if (video) handleSeek(Math.min(duration, video.currentTime + 10));
        break;
      case 'm':
        toggleMute();
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        background: '#000',
        borderRadius: 8,
        overflow: 'hidden',
        outline: 'none',
      }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          cursor: 'pointer',
        }}
      />

      {/* Controls overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
          padding: '24px 12px 12px',
          opacity: showControls ? 1 : 0,
          transition: 'opacity 200ms ease',
          pointerEvents: showControls ? 'auto' : 'none',
        }}
      >
        {/* Progress bar */}
        <Slider
          min={0}
          max={duration || 1}
          value={currentTime}
          onChange={handleSeek}
          tooltip={{ formatter: (v) => (v != null ? formatDuration(v) : '') }}
          styles={{
            track: { background: colors.accent },
            handle: { borderColor: colors.accent },
          }}
          style={{ margin: '0 0 8px 0' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#fff',
              padding: 4,
            }}
          >
            {playing ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" />}
          </button>

          {/* Time */}
          <span style={{ color: '#fff', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          <div style={{ flex: 1 }} />

          {/* Volume */}
          <button
            onClick={toggleMute}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#fff',
              padding: 4,
            }}
          >
            {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
          </button>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolume}
            style={{ width: 80 }}
            styles={{
              track: { background: colors.accent },
              handle: { borderColor: colors.accent },
            }}
          />

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#fff',
              padding: 4,
            }}
          >
            <CornersOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
