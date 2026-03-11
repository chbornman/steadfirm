import { create } from 'zustand';
import type { Audiobook, Chapter } from '@steadfirm/shared';

interface AudiobookPlayerState {
  book: Audiobook | null;
  chapters: Chapter[];
  currentChapter: number;
  position: number;
  speed: number;
  isPlaying: boolean;
  sessionId: string | null;
  streamUrl: string | null;

  startBook: (
    book: Audiobook,
    chapters: Chapter[],
    sessionId: string,
    streamUrl: string,
    resumePosition?: number,
  ) => void;
  pause: () => void;
  resume: () => void;
  seekTo: (seconds: number) => void;
  jumpToChapter: (index: number) => void;
  setSpeed: (speed: number) => void;
  setPosition: (seconds: number) => void;
  stop: () => void;
}

export const useAudiobookPlayerStore = create<AudiobookPlayerState>()((set, get) => ({
  book: null,
  chapters: [],
  currentChapter: 0,
  position: 0,
  speed: 1,
  isPlaying: false,
  sessionId: null,
  streamUrl: null,

  startBook: (book, chapters, sessionId, streamUrl, resumePosition) => {
    const position = resumePosition ?? 0;
    const chapterIndex = chapters.findIndex((ch) => position >= ch.start && position < ch.end);
    set({
      book,
      chapters,
      currentChapter: Math.max(0, chapterIndex),
      position,
      isPlaying: true,
      sessionId,
      streamUrl,
    });
  },

  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  seekTo: (seconds) => {
    const { chapters } = get();
    const chapterIndex = chapters.findIndex((ch) => seconds >= ch.start && seconds < ch.end);
    set({
      position: seconds,
      currentChapter: Math.max(0, chapterIndex),
    });
  },

  jumpToChapter: (index) => {
    const { chapters } = get();
    const chapter = chapters[index];
    if (chapter) {
      set({
        currentChapter: index,
        position: chapter.start,
      });
    }
  },

  setSpeed: (speed) => set({ speed }),

  setPosition: (seconds) => {
    const { chapters } = get();
    const chapterIndex = chapters.findIndex((ch) => seconds >= ch.start && seconds < ch.end);
    set({
      position: seconds,
      currentChapter: chapterIndex >= 0 ? chapterIndex : get().currentChapter,
    });
  },

  stop: () =>
    set({
      book: null,
      chapters: [],
      currentChapter: 0,
      position: 0,
      isPlaying: false,
      sessionId: null,
      streamUrl: null,
    }),
}));
