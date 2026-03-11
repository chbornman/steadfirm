import type {
  Photo,
  Movie,
  TvShow,
  Document,
  Audiobook,
  UserFile,
} from './models';

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  nextPage: number | null;
}

export type PhotoListResponse = PaginatedResponse<Photo>;
export type MovieListResponse = PaginatedResponse<Movie>;
export type ShowListResponse = PaginatedResponse<TvShow>;
export type DocumentListResponse = PaginatedResponse<Document>;
export type AudiobookListResponse = PaginatedResponse<Audiobook>;
export type FileListResponse = PaginatedResponse<UserFile>;

export interface UploadResponse {
  status: string;
  service: string;
  filename: string;
}

export interface ClassificationResult {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  suggestedService: 'photos' | 'media' | 'documents' | 'audiobooks' | 'files';
  confidence: number;
}
