/**
 * SSE (Server-Sent Events) parsing utilities for streaming responses.
 *
 * We use fetch() + ReadableStream instead of EventSource because
 * EventSource only supports GET requests, and our classify endpoint
 * is POST.
 */

export interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse SSE lines from a text buffer, returning parsed events and any
 * remaining incomplete text that should be carried forward.
 *
 * SSE format:
 *   event: <name>\n
 *   data: <line1>\n
 *   data: <line2>\n
 *   \n  (blank line = end of event)
 */
export function parseSSEBuffer(buffer: string): {
  events: SSEEvent[];
  remaining: string;
} {
  const events: SSEEvent[] = [];

  // Split on double newline (event boundary)
  const parts = buffer.split('\n\n');
  // Last part is either empty (buffer ended with \n\n) or incomplete
  const remaining = parts.pop() ?? '';

  for (const part of parts) {
    if (!part.trim()) continue;

    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) {
        eventName = line.slice(7);
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      } else if (line === 'data:') {
        dataLines.push('');
      }
    }

    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join('\n') });
    }
  }

  return { events, remaining };
}

/**
 * Extract complete JSON objects from a partially-streamed JSON string.
 *
 * The LLM streams JSON like: `{"files": [{...}, {...}, ...]}`
 * As tokens arrive, this function finds all fully-formed `{...}` objects
 * within the first `[...]` array by tracking brace depth and respecting
 * string literals / escape sequences.
 *
 * Returns an array of successfully parsed objects. Partial/incomplete
 * objects at the end are silently skipped — they'll be picked up on
 * the next call as more tokens arrive.
 *
 * Ported from collabframe's `extractPartialChanges()`.
 */
export function extractPartialObjects<T>(accumulated: string): T[] {
  // Find the start of the array (e.g. after `"files": [`)
  const arrayStart = accumulated.indexOf('[');
  if (arrayStart < 0) return [];

  const results: T[] = [];
  let i = arrayStart + 1;
  const len = accumulated.length;

  while (i < len) {
    // Skip whitespace and commas between objects
    while (
      i < len &&
      (accumulated[i] === ' ' ||
        accumulated[i] === '\n' ||
        accumulated[i] === ',' ||
        accumulated[i] === '\r' ||
        accumulated[i] === '\t')
    ) {
      i++;
    }
    if (i >= len || accumulated[i] !== '{') break;

    // Find the matching closing brace by tracking depth
    const objStart = i;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; i < len; i++) {
      const ch = accumulated[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          // Found a complete object — try to parse it
          const objStr = accumulated.slice(objStart, i + 1);
          try {
            results.push(JSON.parse(objStr) as T);
          } catch {
            // Malformed — skip
          }
          i++;
          break;
        }
      }
    }

    // If inner loop exited without closing, the object is incomplete — stop
    if (depth > 0) break;
  }

  return results;
}
