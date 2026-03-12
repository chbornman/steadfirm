import { API_PREFIX } from '@steadfirm/shared';
import type { SearchRequest } from '@steadfirm/shared';

/**
 * Start a streaming search via POST + SSE.
 *
 * Returns the raw Response so the caller (useSearch hook) can read
 * the SSE stream via ReadableStream.
 */
export async function searchStream(request: SearchRequest): Promise<Response> {
  const resp = await fetch(`${API_PREFIX}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(request),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown error');
    throw new Error(`Search failed (${resp.status}): ${text}`);
  }

  return resp;
}
