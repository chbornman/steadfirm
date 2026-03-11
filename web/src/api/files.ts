import type { FileListResponse } from '@steadfirm/shared';
import { api } from './client';

export const fileQueries = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    sort?: string;
    order?: string;
  }) => ({
    queryKey: ['files', 'list', params] as const,
    queryFn: () =>
      api
        .get('api/v1/files', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
            ...(params?.sort && { sort: params.sort }),
            ...(params?.order && { order: params.order }),
          },
        })
        .json<FileListResponse>(),
  }),
};

export async function deleteFile(id: string): Promise<void> {
  await api.delete(`api/v1/files/${id}`);
}

export async function reclassifyFile(
  id: string,
  service: string,
): Promise<{ service: string; status: string }> {
  return api
    .post(`api/v1/files/${id}/reclassify`, { json: { service } })
    .json<{ service: string; status: string }>();
}
