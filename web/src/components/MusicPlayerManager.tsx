import { useRef, useEffect, useState, useCallback } from 'react';
import { Drawer } from 'antd';
import { MusicPlayerBar, MusicQueue } from '@steadfirm/ui';
import type { MusicPlayerBarState, MusicPlayerBarAction } from '@steadfirm/ui';
import { useMusicPlayerStore } from '@/stores/music-player';

export function MusicPlayerManager() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const store = useMusicPlayerStore();
  const currentTrack = store.queue[store.currentIndex] ?? null;

  // Sync playback state to audio element
  useEffect(() => {
    if (!audioRef.current) return;
    if (store.isPlaying) {
      void audioRef.current.play().catch(() => { /* autoplay blocked */ });
    } else {
      audioRef.current.pause();
    }
  }, [store.isPlaying, currentTrack?.id]);

  // Load new track
  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;
    audioRef.current.src = currentTrack.streamUrl;
    if (store.isPlaying) {
      void audioRef.current.play().catch(() => { /* autoplay blocked */ });
    }
  }, [currentTrack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = useCallback(
    (action: MusicPlayerBarAction) => {
      const audio = audioRef.current;
      switch (action.type) {
        case 'play':
          store.resume();
          break;
        case 'pause':
          store.pause();
          break;
        case 'next':
          store.next();
          break;
        case 'previous':
          store.previous();
          break;
        case 'seek':
          if (audio) {
            audio.currentTime = action.time;
            setCurrentTime(action.time);
          }
          break;
        case 'volume':
          if (audio) {
            audio.volume = action.value;
            setVolume(action.value);
            setMuted(action.value === 0);
          }
          break;
        case 'toggleMute':
          if (audio) {
            audio.muted = !muted;
            setMuted(!muted);
          }
          break;
        case 'toggleShuffle':
          store.toggleShuffle();
          break;
        case 'cycleRepeat': {
          const modes = ['off', 'all', 'one'] as const;
          const idx = modes.indexOf(store.repeat);
          const next = modes[(idx + 1) % modes.length];
          if (next) store.setRepeat(next);
          break;
        }
        case 'toggleQueue':
          setQueueOpen(!queueOpen);
          break;
      }
    },
    [store, muted, queueOpen],
  );

  const state: MusicPlayerBarState = {
    currentTrack,
    isPlaying: store.isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    shuffle: store.shuffle,
    repeat: store.repeat,
  };

  const handleEnded = () => {
    if (store.repeat === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play();
    } else {
      store.next();
    }
  };

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onEnded={handleEnded}
      />

      <MusicPlayerBar state={state} onAction={handleAction} />

      <Drawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        placement="bottom"
        height="50vh"
        title="Queue"
        styles={{ body: { padding: 0 } }}
      >
        <MusicQueue
          queue={store.queue}
          currentIndex={store.currentIndex}
          onSelect={(index) => {
            const track = store.queue[index];
            if (track) store.play(track, store.queue);
          }}
          onRemove={(index) => store.removeFromQueue(index)}
        />
      </Drawer>
    </>
  );
}
