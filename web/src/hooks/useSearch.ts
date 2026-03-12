/**
 * Hook for streaming global search via SSE.
 *
 * Uses fetch() + ReadableStream (same pattern as useStreamingClassify).
 * Results arrive per-service and accumulate in state. The caller gets
 * live-updating grouped results as each service responds.
 */

import { useCallback, useRef, useState } from 'react';
import type {
  ServiceName,
  ServiceSearchResult,
  SearchComplete,
} from '@steadfirm/shared';
import { parseSSEBuffer } from '@/lib/sse';
import { searchStream } from '@/api/search';

export type SearchPhase = 'idle' | 'searching' | 'done' | 'error';

export interface SearchState {
  phase: SearchPhase;
  /** Results grouped by service, accumulated as SSE events arrive. */
  results: Map<ServiceName, ServiceSearchResult>;
  /** Flat list of all results in arrival order (for rendering). */
  allResults: ServiceSearchResult[];
  /** Completion info (populated when done). */
  complete: SearchComplete | null;
  /** Error message if phase is 'error'. */
  error: string | null;
}

const INITIAL_STATE: SearchState = {
  phase: 'idle',
  results: new Map(),
  allResults: [],
  complete: null,
  error: null,
};

export function useSearch() {
  const [state, setState] = useState<SearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (query: string, services?: ServiceName[]) => {
    // Abort any in-flight search.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      phase: 'searching',
      results: new Map(),
      allResults: [],
      complete: null,
      error: null,
    });

    try {
      const resp = await searchStream({ query, services });
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let sseBuffer = '';

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stream loop
      for (let done = false; !done; ) {
        const result = await reader.read();
        done = result.done;
        if (done) break;
        const { value } = result;

        sseBuffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEBuffer(sseBuffer);
        sseBuffer = remaining;

        for (const evt of events) {
          switch (evt.event) {
            case 'results': {
              const data = JSON.parse(evt.data) as ServiceSearchResult;
              setState((prev) => {
                const newResults = new Map(prev.results);
                // Merge: if we already have results for this service
                // (e.g. from fast path, now LLM refined), replace.
                newResults.set(data.service, data);
                return {
                  ...prev,
                  results: newResults,
                  allResults: Array.from(newResults.values()),
                };
              });
              break;
            }

            case 'done': {
              const data = JSON.parse(evt.data) as SearchComplete;
              setState((prev) => ({
                ...prev,
                phase: 'done',
                complete: data,
              }));
              break;
            }

            case 'error': {
              setState((prev) => ({
                ...prev,
                phase: 'error',
                error: evt.data,
              }));
              break;
            }
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: err instanceof Error ? err.message : 'Search failed',
      }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, search, reset };
}
