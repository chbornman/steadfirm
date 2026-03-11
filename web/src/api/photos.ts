import type { PhotoListResponse, Photo } from '@steadfirm/shared';
import { api } from './client';

export const photoQueries = {
  list: (params?: { page?: number; pageSize?: number; sort?: string; order?: string; favorites?: boolean }) => ({
    queryKey: ['photos', 'list', params] as const,
    queryFn: () =>
      api
        .get('api/v1/photos', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
            ...(params?.sort && { sort: params.sort }),
            ...(params?.order && { order: params.order }),
            ...(params?.favorites != null && { favorites: params.favorites }),
          },
        })
        .json<PhotoListResponse>(),
  }),
  detail: (id: string) => ({
    queryKey: ['photos', 'detail', id] as const,
    queryFn: () => api.get(`api/v1/photos/${id}`).json<Photo>(),
  }),
};

export async function toggleFavorite(id: string): Promise<{ isFavorite: boolean }> {
  return api.put(`api/v1/photos/${id}/favorite`).json<{ isFavorite: boolean }>();
}
