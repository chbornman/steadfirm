import type {
  MovieListResponse,
  ShowListResponse,
  Movie,
  TvShow,
  Season,
  Episode,
  Artist,
  Album,
  Track,
  PaginatedResponse,
} from '@steadfirm/shared';
import { api } from './client';

export const movieQueries = {
  list: (params?: { page?: number; pageSize?: number; sort?: string; order?: string }) => ({
    queryKey: ['media', 'movies', 'list', params] as const,
    queryFn: () =>
      api
        .get('api/v1/media/movies', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
            ...(params?.sort && { sort: params.sort }),
            ...(params?.order && { order: params.order }),
          },
        })
        .json<MovieListResponse>(),
  }),
  detail: (id: string) => ({
    queryKey: ['media', 'movies', 'detail', id] as const,
    queryFn: () => api.get(`api/v1/media/${id}`).json<Movie>(),
  }),
};

export const showQueries = {
  list: (params?: { page?: number; pageSize?: number }) => ({
    queryKey: ['media', 'shows', 'list', params] as const,
    queryFn: () =>
      api
        .get('api/v1/media/shows', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
          },
        })
        .json<ShowListResponse>(),
  }),
  detail: (id: string) => ({
    queryKey: ['media', 'shows', 'detail', id] as const,
    queryFn: () => api.get(`api/v1/media/${id}`).json<TvShow>(),
  }),
  seasons: (showId: string) => ({
    queryKey: ['media', 'shows', showId, 'seasons'] as const,
    queryFn: () => api.get(`api/v1/media/shows/${showId}/seasons`).json<Season[]>(),
  }),
  episodes: (showId: string, seasonId: string) => ({
    queryKey: ['media', 'shows', showId, 'seasons', seasonId, 'episodes'] as const,
    queryFn: () =>
      api.get(`api/v1/media/shows/${showId}/seasons/${seasonId}/episodes`).json<Episode[]>(),
  }),
};

export const musicQueries = {
  artists: (params?: { page?: number; pageSize?: number }) => ({
    queryKey: ['media', 'music', 'artists', params] as const,
    queryFn: () =>
      api
        .get('api/v1/media/music/artists', {
          searchParams: {
            ...(params?.page != null && { page: params.page }),
            ...(params?.pageSize != null && { pageSize: params.pageSize }),
          },
        })
        .json<PaginatedResponse<Artist>>(),
  }),
  artistAlbums: (artistId: string) => ({
    queryKey: ['media', 'music', 'artists', artistId, 'albums'] as const,
    queryFn: () =>
      api.get(`api/v1/media/music/artists/${artistId}/albums`).json<Album[]>(),
  }),
  albumTracks: (albumId: string) => ({
    queryKey: ['media', 'music', 'albums', albumId, 'tracks'] as const,
    queryFn: () =>
      api.get(`api/v1/media/music/albums/${albumId}/tracks`).json<Track[]>(),
  }),
};
