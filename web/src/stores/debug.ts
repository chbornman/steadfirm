import { create } from 'zustand';

import type { ClassifyDebugInfo } from '@steadfirm/shared';

/** Width of the debug side panel in pixels. */
export const DEBUG_PANEL_WIDTH = 360;

/** Maximum number of log pairs to keep in the store. */
const MAX_PAIRS = 100;

/** One half of a request/response pair. */
interface DebugLogHalf {
  /** Stringified data (e.g. JSON body). */
  data: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Optional short label (e.g. "POST /classify"). */
  badge?: string;
}

/** LLM prompt details for the debug panel. */
interface DebugPrompts {
  system: string;
  user: string;
  rawResponse?: string;
}

/** A paired request + response log entry. */
export interface DebugLogPair {
  id: string;
  request: DebugLogHalf;
  response: (DebugLogHalf & { type: 'response' | 'error' }) | null;
  prompts: DebugPrompts | null;
  /** Extra metadata from the backend (model, provider, timing). */
  meta: DebugMeta | null;
  collapsed: boolean;
}

/** Extra metadata from the classify debug info. */
interface DebugMeta {
  model: string;
  provider: string;
  fileCount: number;
  durationMs: number;
}

interface DebugState {
  /** Whether the debug panel is visible. */
  visible: boolean;
  /** All log pairs (capped at MAX_PAIRS). */
  pairs: DebugLogPair[];

  /** Toggle the debug panel visibility. */
  toggleVisible: () => void;
  /** Show the debug panel. */
  show: () => void;
  /** Hide the debug panel. */
  hide: () => void;

  /**
   * Record a new request. Returns the pair ID so the caller can later
   * attach the response via `addResponse`.
   */
  addRequest: (data: string, badge?: string) => string;

  /**
   * Attach a response (or error) to an existing pair, optionally with
   * LLM prompt details and debug metadata.
   */
  addResponse: (
    pairId: string,
    type: 'response' | 'error',
    data: string,
    badge?: string,
    debugInfo?: ClassifyDebugInfo,
  ) => void;

  /** Remove all log entries. */
  clearEntries: () => void;

  /** Toggle the collapsed state of a pair. */
  toggleCollapse: (id: string) => void;
}

let nextId = 0;

export const useDebugStore = create<DebugState>((set) => ({
  visible: false,
  pairs: [],

  toggleVisible: () => set((s) => ({ visible: !s.visible })),
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),

  addRequest: (data, badge) => {
    const id = `debug-${++nextId}-${Date.now()}`;
    const pair: DebugLogPair = {
      id,
      request: { data, timestamp: new Date().toISOString(), badge },
      response: null,
      prompts: null,
      meta: null,
      collapsed: true,
    };

    set((s) => ({
      pairs: [...s.pairs, pair].slice(-MAX_PAIRS),
    }));

    return id;
  },

  addResponse: (pairId, type, data, badge, debugInfo) => {
    set((s) => ({
      pairs: s.pairs.map((p) => {
        if (p.id !== pairId) return p;

        const prompts: DebugPrompts | null = debugInfo
          ? {
              system: debugInfo.systemPrompt,
              user: debugInfo.userPrompt,
              rawResponse: debugInfo.rawResponse,
            }
          : null;

        const meta: DebugMeta | null = debugInfo
          ? {
              model: debugInfo.model,
              provider: debugInfo.provider,
              fileCount: debugInfo.fileCount,
              durationMs: debugInfo.durationMs,
            }
          : null;

        return {
          ...p,
          response: { data, timestamp: new Date().toISOString(), badge, type },
          prompts,
          meta,
          collapsed: false, // Auto-expand when response arrives
        };
      }),
    }));
  },

  clearEntries: () => set({ pairs: [] }),

  toggleCollapse: (id) => {
    set((s) => ({
      pairs: s.pairs.map((p) =>
        p.id === id ? { ...p, collapsed: !p.collapsed } : p,
      ),
    }));
  },
}));
