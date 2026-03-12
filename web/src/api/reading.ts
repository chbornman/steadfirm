import type {
  SeriesListResponse,
  Series,
  Volume,
  ReaderChapterInfo,
  BookInfo,
  BookTocEntry,
  ReadingProgress,
  ChapterInfo,
} from '@steadfirm/shared';
import { api } from './client';

export const readingQueries = {
  list: (params?: { page?: number; pageSize?: number }) => ({
    queryKey: ['reading', 'list', params] as const,
    queryFn: () =>
      api
        .get('api/v1/reading', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
          },
        })
        .json<SeriesListResponse>(),
  }),
  detail: (id: string) => ({
    queryKey: ['reading', 'detail', id] as const,
    queryFn: () => api.get(`api/v1/reading/${id}`).json<Series>(),
  }),
  volumes: (seriesId: string) => ({
    queryKey: ['reading', 'volumes', seriesId] as const,
    queryFn: () => api.get(`api/v1/reading/${seriesId}/volumes`).json<Volume[]>(),
  }),
  continuePoint: (seriesId: string) => ({
    queryKey: ['reading', 'continue', seriesId] as const,
    queryFn: () => api.get(`api/v1/reading/${seriesId}/continue`).json<ChapterInfo>(),
  }),

  // Image reader (comic/manga)
  chapterInfo: (chapterId: number) => ({
    queryKey: ['reading', 'chapter-info', chapterId] as const,
    queryFn: () =>
      api.get(`api/v1/reading/chapter/${chapterId}/info`).json<ReaderChapterInfo>(),
  }),

  // EPUB reader
  bookInfo: (chapterId: number) => ({
    queryKey: ['reading', 'book-info', chapterId] as const,
    queryFn: () => api.get(`api/v1/reading/book/${chapterId}/info`).json<BookInfo>(),
  }),
  bookToc: (chapterId: number) => ({
    queryKey: ['reading', 'book-toc', chapterId] as const,
    queryFn: () => api.get(`api/v1/reading/book/${chapterId}/chapters`).json<BookTocEntry[]>(),
  }),
  bookPage: (chapterId: number, page: number) => ({
    queryKey: ['reading', 'book-page', chapterId, page] as const,
    queryFn: () => api.get(`api/v1/reading/book/${chapterId}/page/${page}`).text(),
  }),

  // Progress
  progress: (chapterId: number) => ({
    queryKey: ['reading', 'progress', chapterId] as const,
    queryFn: () => api.get(`api/v1/reading/chapter/${chapterId}/progress`).json<ReadingProgress>(),
  }),
};

/** Save reading progress. */
export async function saveProgress(progress: ReadingProgress): Promise<void> {
  await api.post('api/v1/reading/progress', { json: progress });
}

/** Get the next chapter ID. Returns -1 if none. */
export async function getNextChapter(
  chapterId: number,
  seriesId: number,
  volumeId: number,
): Promise<number> {
  const resp = await api
    .get(`api/v1/reading/chapter/${chapterId}/next`, {
      searchParams: { seriesId, volumeId },
    })
    .json<{ chapterId: number }>();
  return resp.chapterId;
}

/** Get the previous chapter ID. Returns -1 if none. */
export async function getPrevChapter(
  chapterId: number,
  seriesId: number,
  volumeId: number,
): Promise<number> {
  const resp = await api
    .get(`api/v1/reading/chapter/${chapterId}/prev`, {
      searchParams: { seriesId, volumeId },
    })
    .json<{ chapterId: number }>();
  return resp.chapterId;
}

// ─── URL builders (for <img> src, pdf.js, etc.) ──────────────────────

/** Get the URL for a comic/manga page image. */
export function pageImageUrl(chapterId: number, page: number): string {
  return `${window.location.origin}/api/v1/reading/chapter/${chapterId}/page/${page}`;
}

/** Get the URL for a raw PDF file. */
export function pdfUrl(chapterId: number): string {
  return `${window.location.origin}/api/v1/reading/chapter/${chapterId}/pdf`;
}

/** Get the URL for an EPUB embedded resource. */
export function bookResourceUrl(chapterId: number, file: string): string {
  return `${window.location.origin}/api/v1/reading/book/${chapterId}/resource?file=${encodeURIComponent(file)}`;
}
