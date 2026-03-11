import type { ServiceName } from './constants';

export interface ClassificationResult {
  service: ServiceName;
  confidence: number;
}

const SIZE_500MB = 500 * 1024 * 1024;

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function classifyFile(
  filename: string,
  mimeType: string,
  sizeBytes: number,
): ClassificationResult {
  const ext = getExtension(filename);

  // Photo extensions
  if (['jpg', 'jpeg', 'heic', 'png', 'webp', 'raw', 'dng', 'cr2', 'arw'].includes(ext)) {
    return { service: 'photos', confidence: 0.95 };
  }

  // Video files - size determines photos vs media
  if (['mp4', 'mov'].includes(ext)) {
    if (sizeBytes < SIZE_500MB) {
      return { service: 'photos', confidence: 0.9 };
    }
    return { service: 'media', confidence: 0.8 };
  }

  if (['mkv', 'avi'].includes(ext)) {
    return { service: 'media', confidence: 0.8 };
  }

  // Audiobook
  if (ext === 'm4b') {
    return { service: 'audiobooks', confidence: 0.95 };
  }

  // Music
  if (['mp3', 'flac', 'ogg', 'aac'].includes(ext) && mimeType.startsWith('audio/')) {
    return { service: 'media', confidence: 0.85 };
  }

  // Documents
  if (['pdf', 'docx', 'doc', 'xlsx', 'xls', 'odt'].includes(ext)) {
    return { service: 'documents', confidence: 0.9 };
  }

  // Generic MIME fallbacks
  if (mimeType.startsWith('image/')) {
    return { service: 'photos', confidence: 0.9 };
  }

  if (mimeType.startsWith('video/')) {
    return { service: 'media', confidence: 0.75 };
  }

  if (mimeType.startsWith('audio/')) {
    // Check for audiobook-like patterns in filename
    const lower = filename.toLowerCase();
    if (
      lower.includes('audiobook') ||
      lower.includes('chapter') ||
      lower.includes('narrat')
    ) {
      return { service: 'audiobooks', confidence: 0.8 };
    }
    return { service: 'media', confidence: 0.85 };
  }

  // Everything else goes to files
  return { service: 'files', confidence: 1.0 };
}

export const ALLOWED_UPLOAD_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'application/vnd.',
  'application/msword',
  'application/zip',
  'application/x-',
  'text/',
];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}:${s.toString().padStart(2, '0')}`;
  return `0:${s.toString().padStart(2, '0')}`;
}
