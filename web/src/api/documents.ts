import type { DocumentListResponse, Document } from '@steadfirm/shared';
import { api } from './client';

export interface DocumentTag {
  id: string;
  name: string;
  color: string;
}

export const documentQueries = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    sort?: string;
    order?: string;
    tags?: string;
    query?: string;
  }) => ({
    queryKey: ['documents', 'list', params] as const,
    queryFn: () =>
      api
        .get('api/v1/documents', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
            ...(params?.sort && { sort: params.sort }),
            ...(params?.order && { order: params.order }),
            ...(params?.tags && { tags: params.tags }),
            ...(params?.query && { query: params.query }),
          },
        })
        .json<DocumentListResponse>(),
  }),
  detail: (id: string) => ({
    queryKey: ['documents', 'detail', id] as const,
    queryFn: () => api.get(`api/v1/documents/${id}`).json<Document>(),
  }),
  tags: () => ({
    queryKey: ['documents', 'tags'] as const,
    queryFn: () => api.get('api/v1/documents/tags').json<DocumentTag[]>(),
  }),
};
