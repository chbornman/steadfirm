export const SERVICES = ['photos', 'media', 'documents', 'audiobooks', 'reading', 'files'] as const;
export type ServiceName = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<ServiceName, string> = {
  photos: 'Personal Media',
  media: 'Film & TV',
  documents: 'Documents',
  audiobooks: 'Audiobooks',
  reading: 'Reading',
  files: 'Files',
};

export const SERVICE_COLORS: Record<ServiceName, string> = {
  photos: '#3B82F6',
  media: '#8B5CF6',
  documents: '#22C55E',
  audiobooks: '#D97706',
  reading: '#EC4899',
  files: '#737373',
};

export const API_PREFIX = '/api/v1';
export const AUTH_PREFIX = '/api/auth';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

export const ROUTES = {
  LOGIN: '/login',
  SIGNUP: '/signup',
  PHOTOS: '/photos',
  MEDIA: '/media',
  MEDIA_MOVIES: '/media/movies',
  MEDIA_SHOWS: '/media/shows',
  MUSIC: '/music',
  MUSIC_ARTIST: '/music/$artistId',
  DOCUMENTS: '/documents',
  AUDIOBOOKS: '/audiobooks',
  READING: '/reading',
  FILES: '/files',
  UPLOAD: '/upload',
  SETTINGS: '/settings',
} as const;
