export type {
  Photo,
  Movie,
  TvShow,
  Season,
  Episode,
  Artist,
  Album,
  Track,
  Document,
  Audiobook,
  Chapter,
  UserFile,
} from './types/models';

export type {
  PaginatedResponse,
  PhotoListResponse,
  MovieListResponse,
  ShowListResponse,
  DocumentListResponse,
  AudiobookListResponse,
  FileListResponse,
  UploadResponse,
  UploadedFileClassification,
  UploadConfirmRequest,
} from './types/api';

export type { User, Session, UserProfile } from './types/auth';

export {
  SERVICES,
  SERVICE_LABELS,
  SERVICE_COLORS,
  API_PREFIX,
  AUTH_PREFIX,
  DEFAULT_PAGE_SIZE,
  MAX_UPLOAD_SIZE_BYTES,
  ROUTES,
} from './constants';
export type { ServiceName } from './constants';

export {
  classifyFile,
  formatFileSize,
  formatDuration,
  ALLOWED_UPLOAD_MIME_PREFIXES,
} from './validation';
export type { ClassificationResult } from './validation';
