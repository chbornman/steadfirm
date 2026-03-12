import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Keys matching navItems in AppLayout. */
export type TabKey =
  | '/photos'
  | '/media/movies'
  | '/music'
  | '/documents'
  | '/audiobooks'
  | '/reading'
  | '/files';

/** All tab keys in display order. */
export const ALL_TAB_KEYS: TabKey[] = [
  '/photos',
  '/media/movies',
  '/music',
  '/documents',
  '/audiobooks',
  '/reading',
  '/files',
];

/** Human-readable labels for each tab key. */
export const TAB_LABELS: Record<TabKey, string> = {
  '/photos': 'Personal Media',
  '/media/movies': 'Film & TV',
  '/music': 'Music',
  '/documents': 'Documents',
  '/audiobooks': 'Audiobooks',
  '/reading': 'Reading',
  '/files': 'Files',
};

interface PreferencesState {
  /** When true, all tabs are shown regardless of individual toggles. */
  showAllTabs: boolean;
  /** Per-tab visibility. Tabs default to visible. */
  hiddenTabs: TabKey[];
  setShowAllTabs: (value: boolean) => void;
  toggleTab: (key: TabKey) => void;
  isTabVisible: (key: TabKey) => boolean;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      showAllTabs: true,
      hiddenTabs: [],
      setShowAllTabs: (value: boolean) => set({ showAllTabs: value }),
      toggleTab: (key: TabKey) => {
        const { hiddenTabs } = get();
        if (hiddenTabs.includes(key)) {
          set({ hiddenTabs: hiddenTabs.filter((k) => k !== key) });
        } else {
          set({ hiddenTabs: [...hiddenTabs, key] });
        }
      },
      isTabVisible: (key: TabKey) => {
        const { showAllTabs, hiddenTabs } = get();
        if (showAllTabs) return true;
        return !hiddenTabs.includes(key);
      },
    }),
    {
      name: 'steadfirm-preferences',
      partialize: (state) => ({
        showAllTabs: state.showAllTabs,
        hiddenTabs: state.hiddenTabs,
      }),
    },
  ),
);
