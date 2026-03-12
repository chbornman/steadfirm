import type { SeriesListResponse, Series } from '@steadfirm/shared';
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
};
