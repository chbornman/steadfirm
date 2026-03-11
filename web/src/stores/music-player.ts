import { create } from 'zustand';
import type { Track } from '@steadfirm/shared';

interface MusicPlayerState {
  queue: Track[];
  currentIndex: number;
  shuffledIndices: number[] | null;
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
  isPlaying: boolean;
  lastActiveAt: number;

  play: (track: Track, queue?: Track[]) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  previous: () => void;
  setRepeat: (mode: 'off' | 'all' | 'one') => void;
  toggleShuffle: () => void;
  addToQueue: (tracks: Track[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
}

function shuffleIndices(length: number, currentIndex: number): number[] {
  const indices = Array.from({ length }, (_, i) => i).filter((i) => i !== currentIndex);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j] as number;
    indices[j] = tmp as number;
  }
  return [currentIndex, ...indices];
}

export const useMusicPlayerStore = create<MusicPlayerState>()((set, get) => ({
  queue: [],
  currentIndex: 0,
  shuffledIndices: null,
  repeat: 'off',
  shuffle: false,
  isPlaying: false,
  lastActiveAt: 0,

  play: (track, queue) => {
    const newQueue = queue ?? [track];
    const index = queue ? newQueue.findIndex((t) => t.id === track.id) : 0;
    set({
      queue: newQueue,
      currentIndex: index >= 0 ? index : 0,
      isPlaying: true,
      shuffledIndices: null,
      lastActiveAt: Date.now(),
    });
  },

  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true, lastActiveAt: Date.now() }),

  next: () => {
    const { queue, currentIndex, repeat, shuffledIndices } = get();
    if (queue.length === 0) return;

    if (repeat === 'one') {
      // Restart current track - handled by player component
      return;
    }

    let nextIndex: number;
    if (shuffledIndices) {
      const shufflePos = shuffledIndices.indexOf(currentIndex);
      const nextShufflePos = shufflePos + 1;
      if (nextShufflePos >= shuffledIndices.length) {
        if (repeat === 'all') {
          nextIndex = shuffledIndices[0] ?? 0;
        } else {
          set({ isPlaying: false });
          return;
        }
      } else {
        nextIndex = shuffledIndices[nextShufflePos] ?? 0;
      }
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeat === 'all') {
          nextIndex = 0;
        } else {
          set({ isPlaying: false });
          return;
        }
      }
    }

    set({ currentIndex: nextIndex });
  },

  previous: () => {
    const { currentIndex, shuffledIndices } = get();

    if (shuffledIndices) {
      const shufflePos = shuffledIndices.indexOf(currentIndex);
      const prevShufflePos = Math.max(0, shufflePos - 1);
      set({ currentIndex: shuffledIndices[prevShufflePos] ?? 0 });
    } else {
      set({ currentIndex: Math.max(0, currentIndex - 1) });
    }
  },

  setRepeat: (mode) => set({ repeat: mode }),

  toggleShuffle: () => {
    const { shuffle, queue, currentIndex } = get();
    if (shuffle) {
      set({ shuffle: false, shuffledIndices: null });
    } else {
      set({
        shuffle: true,
        shuffledIndices: shuffleIndices(queue.length, currentIndex),
      });
    }
  },

  addToQueue: (tracks) => {
    set((state) => ({ queue: [...state.queue, ...tracks] }));
  },

  removeFromQueue: (index) => {
    set((state) => {
      const newQueue = state.queue.filter((_, i) => i !== index);
      const newIndex =
        index < state.currentIndex
          ? state.currentIndex - 1
          : index === state.currentIndex
            ? Math.min(state.currentIndex, newQueue.length - 1)
            : state.currentIndex;
      return { queue: newQueue, currentIndex: Math.max(0, newIndex) };
    });
  },

  clearQueue: () => set({ queue: [], currentIndex: 0, isPlaying: false, shuffledIndices: null, lastActiveAt: 0 }),
}));
