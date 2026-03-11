import { useRef, useEffect, useState, useCallback } from 'react';
import { Drawer } from 'antd';
import { AudiobookPlayerBar, AudiobookChapters } from '@steadfirm/ui';
import type { AudiobookPlayerBarState, AudiobookPlayerBarAction } from '@steadfirm/ui';
import { useAudiobookPlayerStore } from '@/stores/audiobook-player';
import { syncProgress } from '@/api/audiobooks';

export function AudiobookPlayerManager() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const store = useAudiobookPlayerStore();

  // Load stream
  useEffect(() => {
    if (!audioRef.current || !store.streamUrl) return;
    audioRef.current.src = store.streamUrl;
    if (store.position > 0) {
      audioRef.current.currentTime = store.position;
    }
    if (store.isPlaying) {
      void audioRef.current.play().catch(() => { /* autoplay blocked */ });
    }
  }, [store.streamUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play/pause sync
  useEffect(() => {
    if (!audioRef.current) return;
    if (store.isPlaying) {
      void audioRef.current.play().catch(() => { /* autoplay blocked */ });
    } else {
      audioRef.current.pause();
    }
  }, [store.isPlaying]);

  // Speed sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = store.speed;
    }
  }, [store.speed]);

  // Progress sync every 30s
  useEffect(() => {
    if (store.isPlaying && store.book) {
      syncTimer.current = setInterval(() => {
        if (store.book && audioRef.current) {
          void syncProgress(store.book.id, {
            currentTime: audioRef.current.currentTime,
            duration: store.book.duration,
            progress: audioRef.current.currentTime / store.book.duration,
          });
        }
      }, 30000);
    }
    return () => {
      if (syncTimer.current) clearInterval(syncTimer.current);
    };
  }, [store.isPlaying, store.book]);

  const currentChapter = store.chapters[store.currentChapter];

  const handleAction = useCallback(
    (action: AudiobookPlayerBarAction) => {
      const audio = audioRef.current;
      switch (action.type) {
        case 'play':
          store.resume();
          break;
        case 'pause':
          store.pause();
          // Sync on pause
          if (store.book && audio) {
            void syncProgress(store.book.id, {
              currentTime: audio.currentTime,
              duration: store.book.duration,
              progress: audio.currentTime / store.book.duration,
            });
          }
          break;
        case 'skipForward':
          if (audio) {
            audio.currentTime = Math.min(duration, audio.currentTime + 30);
            setCurrentTime(audio.currentTime);
            store.setPosition(audio.currentTime);
          }
          break;
        case 'skipBack':
          if (audio) {
            audio.currentTime = Math.max(0, audio.currentTime - 30);
            setCurrentTime(audio.currentTime);
            store.setPosition(audio.currentTime);
          }
          break;
        case 'seek':
          if (audio) {
            audio.currentTime = action.time;
            setCurrentTime(action.time);
            store.setPosition(action.time);
          }
          break;
        case 'cycleSpeed': {
          const speeds = [0.75, 1, 1.25, 1.5, 2];
          const idx = speeds.indexOf(store.speed);
          const nextIdx = (idx + 1) % speeds.length;
          const nextSpeed = speeds[nextIdx];
          if (nextSpeed !== undefined) {
            store.setSpeed(nextSpeed);
          }
          break;
        }
        case 'toggleChapters':
          setChaptersOpen(!chaptersOpen);
          break;
      }
    },
    [store, duration, chaptersOpen],
  );

  const state: AudiobookPlayerBarState = {
    book: store.book ? { title: store.book.title, coverUrl: store.book.coverUrl } : null,
    chapterName: currentChapter?.title ?? '',
    isPlaying: store.isPlaying,
    currentTime,
    duration: store.book?.duration ?? 0,
    speed: store.speed,
  };

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            store.setPosition(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
      />

      <AudiobookPlayerBar state={state} onAction={handleAction} />

      <Drawer
        open={chaptersOpen}
        onClose={() => setChaptersOpen(false)}
        placement="bottom"
        height="50vh"
        title="Chapters"
        styles={{ body: { padding: 0 } }}
      >
        <AudiobookChapters
          chapters={store.chapters}
          currentChapter={store.currentChapter}
          onSelect={(index) => {
            store.jumpToChapter(index);
            const chapter = store.chapters[index];
            if (chapter && audioRef.current) {
              audioRef.current.currentTime = chapter.start;
              setCurrentTime(chapter.start);
            }
          }}
        />
      </Drawer>
    </>
  );
}
