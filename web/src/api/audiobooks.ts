import type { AudiobookListResponse, Audiobook, Chapter } from '@steadfirm/shared';
import { api } from './client';

export interface AudiobookDetail extends Audiobook {
  chapters: Chapter[];
}

export interface PlaybackSession {
  sessionId: string;
  audioTracks: {
    contentUrl: string;
    mimeType: string;
    duration: number;
  }[];
  currentTime: number;
  chapters: Chapter[];
}

export const audiobookQueries = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    sort?: string;
    order?: string;
  }) => ({
    queryKey: ['audiobooks', 'list', params] as const,
    queryFn: () =>
      api
        .get('api/v1/audiobooks', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
            ...(params?.sort && { sort: params.sort }),
            ...(params?.order && { order: params.order }),
          },
        })
        .json<AudiobookListResponse>(),
  }),
  detail: (id: string) => ({
    queryKey: ['audiobooks', 'detail', id] as const,
    queryFn: () => api.get(`api/v1/audiobooks/${id}`).json<AudiobookDetail>(),
  }),
};

export async function startPlayback(id: string): Promise<PlaybackSession> {
  return api.post(`api/v1/audiobooks/${id}/play`).json<PlaybackSession>();
}

export async function syncProgress(
  id: string,
  data: { currentTime: number; duration: number; progress: number },
): Promise<void> {
  await api.patch(`api/v1/audiobooks/${id}/progress`, { json: data });
}

export async function createBookmark(
  id: string,
  data: { title: string; time: number },
): Promise<void> {
  await api.post(`api/v1/audiobooks/${id}/bookmarks`, { json: data });
}
