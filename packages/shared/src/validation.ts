import type { ServiceName } from './constants';

export interface ClassificationResult {
  service: ServiceName;
  confidence: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

// ─── Classification logic ────────────────────────────────────────────

/**
 * Classify a single file based on extension and MIME type only.
 *
 * This is a minimal first pass — ambiguous files (audio, video) get low
 * confidence so they are sent to the LLM for proper classification with
 * full context (folder structure, batch analysis, etc.).
 */
export function classifyFile(
  filename: string,
  mimeType: string,
  _sizeBytes: number,
  _relativePath?: string,
): ClassificationResult {
  const ext = getExtension(filename);

  // ── Photos: image extensions are unambiguous ──
  if (['jpg', 'jpeg', 'heic', 'png', 'webp', 'gif', 'raw', 'dng', 'cr2', 'arw', 'nef', 'orf'].includes(ext)) {
    return { service: 'photos', confidence: 0.95 };
  }

  // ── Documents: office/text formats are unambiguous ──
  if (['docx', 'doc', 'xlsx', 'xls', 'odt', 'ods', 'pptx', 'ppt', 'txt', 'rtf', 'csv'].includes(ext)) {
    return { service: 'documents', confidence: 0.92 };
  }

  // ── Reading: ebooks are always for reading ──
  if (['epub', 'mobi', 'azw', 'azw3', 'fb2'].includes(ext)) {
    return { service: 'reading', confidence: 0.95 };
  }

  // ── Reading: comics/manga are always for reading ──
  if (['cbz', 'cbr', 'cb7', 'cbt', 'cba'].includes(ext)) {
    return { service: 'reading', confidence: 0.95 };
  }

  // ── PDF: could be a document to archive or a book to read — let LLM decide ──
  if (ext === 'pdf') {
    return { service: 'documents', confidence: 0.5 };
  }

  // ── M4B is always an audiobook ──
  if (ext === 'm4b') {
    return { service: 'audiobooks', confidence: 0.98 };
  }

  // ── Video: could be personal video, movie, or TV — let LLM decide ──
  if (['mp4', 'mov', 'mkv', 'avi', 'wmv', 'webm', 'flv', 'm4v', 'ts'].includes(ext)) {
    return { service: 'media', confidence: 0.5 };
  }

  // ── Audio: could be music or audiobook — let LLM decide ──
  if (['mp3', 'flac', 'ogg', 'aac', 'wma', 'opus', 'm4a', 'wav'].includes(ext)) {
    return { service: 'media', confidence: 0.5 };
  }

  // ── Generic MIME fallbacks ──
  if (mimeType.startsWith('image/')) {
    return { service: 'photos', confidence: 0.9 };
  }
  if (mimeType.startsWith('video/')) {
    return { service: 'media', confidence: 0.5 };
  }
  if (mimeType.startsWith('audio/')) {
    return { service: 'media', confidence: 0.5 };
  }

  // ── Everything else goes to files ──
  return { service: 'files', confidence: 1.0 };
}

// ─── Utilities ───────────────────────────────────────────────────────

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
