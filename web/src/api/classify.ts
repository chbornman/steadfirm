import type { ClassifyResponse, FileEntry } from '@steadfirm/shared';
import { api } from './client';

/**
 * Send a batch of file metadata to the backend for AI-assisted classification.
 * Only called for files where the client-side heuristic confidence is below
 * the threshold.
 */
export async function classifyFiles(files: FileEntry[]): Promise<ClassifyResponse> {
  return api
    .post('api/v1/classify', {
      json: { files },
      timeout: 60_000, // LLM calls can take a while
    })
    .json<ClassifyResponse>();
}
