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
  files: UploadedFileClassification[];
}

export interface UploadedFileClassification {
  uploadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  suggestedService: 'photos' | 'media' | 'documents' | 'audiobooks' | 'files';
  confidence: number;
}

export interface UploadConfirmRequest {
  files: { uploadId: string; service: string }[];
}
