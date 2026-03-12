/**
 * Hook for streaming file classification via SSE.
 *
 * Uses fetch() + ReadableStream (not EventSource, which is GET-only).
 * Receives individual classification results as they become available:
 * heuristic results instantly, LLM results staggered visually via a
 * frontend queue (backend sends them all at once after the LLM responds,
 * but we drain them with a delay so each file animates into its bucket).
 */

import { useCallback, useRef, useState } from 'react';
import type {
  ServiceName,
  AudiobookGroup,
  TvShowGroup,
  MovieGroup,
  MusicAlbumGroup,
  ReadingGroup,
  ClassifyDebugInfo,
} from '@steadfirm/shared';
import { parseSSEBuffer, extractPartialObjects } from '@/lib/sse';
import { useDebugStore } from '@/stores/debug';

/** Prefixed console.log for SSE debugging — easy to filter in DevTools. */
const sseLog = (...args: unknown[]) => {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`%c[sse ${ts}]`, 'color:#0ea5e9;font-weight:bold', ...args);
};

// ─── Constants ───────────────────────────────────────────────────────

/** Delay between draining queued classification results (ms). */
const CLASSIFICATION_STAGGER_MS = 60;

/** Minimum interval between partial JSON parses of the token stream (ms). */
const PARTIAL_PARSE_THROTTLE_MS = 150;

// ─── Types ───────────────────────────────────────────────────────────

export type StreamingPhase =
  | 'idle'
  | 'connecting'
  | 'heuristics'
  | 'classifying'
  | 'done'
  | 'error';

/** A single classification result received from the stream. */
export interface StreamedClassification {
  index: number;
  service: ServiceName;
  confidence: number;
  reasoning?: string;
  aiClassified: boolean;
}

interface SseHeuristicData {
  index: number;
  service: ServiceName;
  confidence: number;
}

interface SseStatusData {
  phase: string;
  pending: number;
}

interface SseClassificationData {
  index: number;
  service: ServiceName;
  confidence: number;
  reasoning?: string;
  aiClassified: boolean;
}

interface SseIndexMapData {
  indexMap: number[];
}

/** Shape of a single file classification as it appears in the LLM JSON response. */
interface LlmFileClassification {
  index: number;
  service: string;
  confidence: number;
  reasoning: string;
  audiobook_metadata?: unknown;
}

interface SseDoneData {
  /** Authoritative classifications (global indices). */
  classifications: SseClassificationData[];
  audiobookGroups: AudiobookGroup[];
  tvShowGroups?: TvShowGroup[];
  movieGroups?: MovieGroup[];
  musicGroups?: MusicAlbumGroup[];
  readingGroups?: ReadingGroup[];
  debugInfo?: ClassifyDebugInfo;
}

export interface UseStreamingClassifyReturn {
  /** Start streaming classification for the given files. */
  start: (files: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
    relativePath?: string;
  }>) => void;
  /** Current phase of the streaming lifecycle. */
  phase: StreamingPhase;
  /** Whether a stream is currently active. */
  isPending: boolean;
  /** Map of file index → classification result, populated progressively. */
  classifications: Map<number, StreamedClassification>;
  /** Number of files pending LLM classification (from status event). */
  pendingCount: number;
  /** Audiobook groups (available after done). */
  audiobookGroups: AudiobookGroup[];
  /** TV show groups (available after done). */
  tvShowGroups: TvShowGroup[];
  /** Movie groups (available after done). */
  movieGroups: MovieGroup[];
  /** Music album groups (available after done). */
  musicGroups: MusicAlbumGroup[];
  /** Reading groups (available after done). */
  readingGroups: ReadingGroup[];
  /** Debug info from the LLM call (available after done). */
  debugInfo: ClassifyDebugInfo | null;
  /** Error message if phase=error. */
  error: string | null;
  /** Cancel an in-progress stream. */
  cancel: () => void;
  /** Reset all state back to idle. */
  reset: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useStreamingClassify(): UseStreamingClassifyReturn {
  const [phase, setPhase] = useState<StreamingPhase>('idle');
  const [classifications, setClassifications] = useState<Map<number, StreamedClassification>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const [audiobookGroups, setAudiobookGroups] = useState<AudiobookGroup[]>([]);
  const [tvShowGroups, setTvShowGroups] = useState<TvShowGroup[]>([]);
  const [movieGroups, setMovieGroups] = useState<MovieGroup[]>([]);
  const [musicGroups, setMusicGroups] = useState<MusicAlbumGroup[]>([]);
  const [readingGroups, setReadingGroups] = useState<ReadingGroup[]>([]);
  const [debugInfo, setDebugInfo] = useState<ClassifyDebugInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Queue for staggering classification results visually.
  // With streaming, partial-parsed results arrive progressively as
  // LLM tokens come in. We queue them and drain with setTimeout so
  // each file animates into its category bucket individually.
  const classificationQueueRef = useRef<StreamedClassification[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deferred done data — held until the queue finishes draining.
  const deferredDoneRef = useRef<SseDoneData | null>(null);
  const debugPairIdRef = useRef<string | null>(null);

  // Token streaming state — accumulated LLM text + partial parse tracking.
  const accumulatedRef = useRef('');
  const lastPartialParseRef = useRef(0);
  const lastPartialCountRef = useRef(0);
  const indexMapRef = useRef<number[]>([]);

  const drainQueue = useCallback(() => {
    // The timer that called us has already fired — clear the ref so
    // new items arriving during token streaming can start a fresh timer.
    drainTimerRef.current = null;

    const queue = classificationQueueRef.current;
    if (queue.length === 0) {
      // Queue empty — if we have deferred done data, finalize now
      const doneData = deferredDoneRef.current;
      if (doneData) {
        deferredDoneRef.current = null;
        setAudiobookGroups(doneData.audiobookGroups);
        setTvShowGroups(doneData.tvShowGroups ?? []);
        setMovieGroups(doneData.movieGroups ?? []);
        setMusicGroups(doneData.musicGroups ?? []);
        setReadingGroups(doneData.readingGroups ?? []);
        if (doneData.debugInfo) {
          setDebugInfo(doneData.debugInfo);
        }
        setPhase('done');

        // Log to debug store
        if (import.meta.env.DEV && debugPairIdRef.current) {
          useDebugStore
            .getState()
            .addResponse(
              debugPairIdRef.current,
              'response',
              JSON.stringify(doneData, null, 2),
              `SSE done (${doneData.audiobookGroups.length} audiobook groups)`,
              doneData.debugInfo,
            );
        }

        sseLog('deferred done finalized', {
          audiobookGroups: doneData.audiobookGroups.length,
        });
      }
      return;
    }

    // Pop one item and apply it
    const item = queue.shift();
    if (!item) return;
    setClassifications((prev) => {
      const next = new Map(prev);
      next.set(item.index, item);
      return next;
    });

    // Schedule next drain
    drainTimerRef.current = setTimeout(drainQueue, CLASSIFICATION_STAGGER_MS);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    classificationQueueRef.current = [];
    deferredDoneRef.current = null;
    setPhase('idle');
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    classificationQueueRef.current = [];
    deferredDoneRef.current = null;
    debugPairIdRef.current = null;
    accumulatedRef.current = '';
    lastPartialParseRef.current = 0;
    lastPartialCountRef.current = 0;
    indexMapRef.current = [];
    setPhase('idle');
    setClassifications(new Map());
    setPendingCount(0);
    setAudiobookGroups([]);
    setTvShowGroups([]);
    setMovieGroups([]);
    setMusicGroups([]);
    setReadingGroups([]);
    setDebugInfo(null);
    setError(null);
  }, []);

  const start = useCallback(
    (files: Array<{
      filename: string;
      mimeType: string;
      sizeBytes: number;
      relativePath?: string;
    }>) => {
      // Abort any existing stream
      abortRef.current?.abort();
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
        drainTimerRef.current = null;
      }
      classificationQueueRef.current = [];
      deferredDoneRef.current = null;
      accumulatedRef.current = '';
      lastPartialParseRef.current = 0;
      lastPartialCountRef.current = 0;
      indexMapRef.current = [];

      const controller = new AbortController();
      abortRef.current = controller;

      // Reset state
      setPhase('connecting');
      setClassifications(new Map());
      setPendingCount(0);
      setAudiobookGroups([]);
      setTvShowGroups([]);
      setMovieGroups([]);
      setMusicGroups([]);
      setReadingGroups([]);
      setDebugInfo(null);
      setError(null);

      const run = async () => {
        sseLog('classifying', files.length, 'files');

        // Log request to debug store
        const debugPairId = import.meta.env.DEV
          ? useDebugStore
              .getState()
              .addRequest(
                JSON.stringify({ files }, null, 2),
                `POST /classify/stream (${files.length} files)`,
              )
          : null;
        debugPairIdRef.current = debugPairId;

        try {
          const url = `${window.location.origin}/api/v1/classify/stream`;
          const body = JSON.stringify({ files });
          sseLog('POST', url);

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body,
            signal: controller.signal,
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
          }

          if (!res.body) {
            throw new Error('Response body is null — streaming not supported');
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let receivedDone = false;
          let chunkCount = 0;

          setPhase('heuristics');

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ReadableStream loop pattern
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // stream reader done
              break;
            }

            chunkCount++;
            const text = decoder.decode(value, { stream: true });
            buffer += text;
            const { events, remaining } = parseSSEBuffer(buffer);
            buffer = remaining;

            for (const evt of events) {
              switch (evt.event) {
                case 'log': {
                  // Backend debug breadcrumbs → browser console
                  sseLog('SERVER:', evt.data);
                  break;
                }

                case 'heuristic': {
                  const data = JSON.parse(evt.data) as SseHeuristicData;
                  setClassifications((prev) => {
                    const next = new Map(prev);
                    next.set(data.index, {
                      index: data.index,
                      service: data.service,
                      confidence: data.confidence,
                      aiClassified: false,
                    });
                    return next;
                  });
                  break;
                }

                case 'status': {
                  const data = JSON.parse(evt.data) as SseStatusData;
                  if (data.phase === 'classifying') {
                    setPhase('classifying');
                    setPendingCount(data.pending);
                  }
                  break;
                }

                case 'index_map': {
                  const data = JSON.parse(evt.data) as SseIndexMapData;
                  indexMapRef.current = data.indexMap;
                  break;
                }

                case 'token': {
                  // Accumulate LLM text tokens and do throttled partial parsing
                  accumulatedRef.current += evt.data;

                  const now = Date.now();
                  if (now - lastPartialParseRef.current >= PARTIAL_PARSE_THROTTLE_MS) {
                    lastPartialParseRef.current = now;
                    const partial = extractPartialObjects<LlmFileClassification>(accumulatedRef.current);

                    if (partial.length > lastPartialCountRef.current) {
                      const newItems = partial.slice(lastPartialCountRef.current);
                      lastPartialCountRef.current = partial.length;

                      const imap = indexMapRef.current;
                      for (const item of newItems) {
                        const globalIdx = imap[item.index] ?? item.index;
                        const classification: StreamedClassification = {
                          index: globalIdx,
                          service: item.service as ServiceName,
                          confidence: Math.max(0, Math.min(1, item.confidence)),
                          reasoning: item.reasoning,
                          aiClassified: true,
                        };

                        classificationQueueRef.current.push(classification);
                      }

                      sseLog(`partial parse: ${newItems.length} new classifications (${partial.length} total)`);

                      // Start draining if not already running
                      if (!drainTimerRef.current) {
                        drainTimerRef.current = setTimeout(drainQueue, CLASSIFICATION_STAGGER_MS);
                      }
                    }
                  }
                  break;
                }

                case 'classification': {
                  // Fallback: direct classification events (non-streaming paths)
                  const data = JSON.parse(evt.data) as SseClassificationData;
                  classificationQueueRef.current.push({
                    index: data.index,
                    service: data.service,
                    confidence: data.confidence,
                    reasoning: data.reasoning,
                    aiClassified: data.aiClassified,
                  });

                  if (!drainTimerRef.current) {
                    drainTimerRef.current = setTimeout(drainQueue, CLASSIFICATION_STAGGER_MS);
                  }
                  break;
                }

                case 'done': {
                  receivedDone = true;
                  const data = JSON.parse(evt.data) as SseDoneData;
                  sseLog('done:', data.classifications.length, 'classifications,',
                    data.audiobookGroups.length, 'audiobook groups,',
                    'queue:', classificationQueueRef.current.length);

                  // Apply authoritative classifications from the backend.
                  // Any items not yet in the stagger queue get added now.
                  if (data.classifications.length > 0) {
                    // Build a set of indices already queued or applied
                    const alreadyQueued = new Set<number>();
                    classificationQueueRef.current.forEach((c) => alreadyQueued.add(c.index));

                    for (const c of data.classifications) {
                      if (!alreadyQueued.has(c.index)) {
                        classificationQueueRef.current.push({
                          index: c.index,
                          service: c.service,
                          confidence: c.confidence,
                          reasoning: c.reasoning,
                          aiClassified: c.aiClassified,
                        });
                      }
                    }

                    // Start draining if not already running
                    if (!drainTimerRef.current && classificationQueueRef.current.length > 0) {
                      drainTimerRef.current = setTimeout(drainQueue, CLASSIFICATION_STAGGER_MS);
                    }
                  }

                  if (classificationQueueRef.current.length > 0 || drainTimerRef.current) {
                    deferredDoneRef.current = data;
                  } else {
                    setAudiobookGroups(data.audiobookGroups);
                    setTvShowGroups(data.tvShowGroups ?? []);
                    setMovieGroups(data.movieGroups ?? []);
                    setMusicGroups(data.musicGroups ?? []);
                    setReadingGroups(data.readingGroups ?? []);
                    if (data.debugInfo) {
                      setDebugInfo(data.debugInfo);
                    }
                    setPhase('done');

                    if (import.meta.env.DEV && debugPairId) {
                      useDebugStore
                        .getState()
                        .addResponse(
                          debugPairId,
                          'response',
                          JSON.stringify(data, null, 2),
                          `SSE done (${data.audiobookGroups.length} audiobook groups)`,
                          data.debugInfo,
                        );
                    }
                  }
                  break;
                }

                case 'error': {
                  sseLog('error:', evt.data);
                  if (import.meta.env.DEV && debugPairId) {
                    useDebugStore
                      .getState()
                      .addResponse(debugPairId, 'error', evt.data);
                  }
                  break;
                }

                default:
                  break;
              }
            }
          }

          if (!receivedDone && !deferredDoneRef.current) {
            sseLog('stream ended without done event');
            setPhase('done');
          } else {
            sseLog('stream complete,', chunkCount, 'chunks');
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : 'Unknown streaming error';
          sseLog('error:', message);
          setError(message);
          setPhase('error');

          if (import.meta.env.DEV && debugPairIdRef.current) {
            useDebugStore.getState().addResponse(debugPairIdRef.current, 'error', message);
          }
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        }
      };

      void run();
    },
    [drainQueue],
  );

  return {
    start,
    phase,
    isPending: phase === 'connecting' || phase === 'heuristics' || phase === 'classifying',
    classifications,
    pendingCount,
    audiobookGroups,
    tvShowGroups,
    movieGroups,
    musicGroups,
    readingGroups,
    debugInfo,
    error,
    cancel,
    reset,
  };
}
