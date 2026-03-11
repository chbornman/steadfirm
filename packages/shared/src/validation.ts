import type { ServiceName } from './constants';

export interface ClassificationResult {
  service: ServiceName;
  confidence: number;
}

// ─── Size thresholds ─────────────────────────────────────────────────

const SIZE_100MB = 100 * 1024 * 1024;
const SIZE_500MB = 500 * 1024 * 1024;
const SIZE_2GB = 2 * 1024 * 1024 * 1024;

// ─── Helpers ─────────────────────────────────────────────────────────

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/** Extract the parent folder name from a relative path. */
function getParentFolder(relativePath: string | undefined): string | undefined {
  if (!relativePath) return undefined;
  const parts = relativePath.split('/');
  // At least 2 parts means there's a parent folder
  if (parts.length >= 2) {
    return parts[parts.length - 2]?.toLowerCase();
  }
  return undefined;
}

/** Get all folder segments from a relative path (lowercased). */
function getFolderSegments(relativePath: string | undefined): string[] {
  if (!relativePath) return [];
  const parts = relativePath.split('/');
  // Everything except the last part (which is the filename)
  return parts.slice(0, -1).map((p) => p.toLowerCase());
}

// ─── Pattern matchers ────────────────────────────────────────────────

/** Scene release / movie rip patterns in filenames. */
const MOVIE_RELEASE_PATTERN =
  /(?:\b(?:720p|1080p|2160p|4k|bluray|blu-ray|bdrip|brrip|dvdrip|webrip|web-dl|hdtv|hdrip|remux|x264|x265|h\.?264|h\.?265|hevc|aac|dts|atmos|10bit)\b)/i;

/** Common TV show episode patterns. */
const TV_EPISODE_PATTERN = /\bS\d{1,2}E\d{1,2}\b/i;

/** Patterns indicating a file is a personal/home video. */
const HOME_VIDEO_PATTERNS = [
  /^IMG_\d+/i,
  /^VID_\d+/i,
  /^MVI_\d+/i,
  /^MOV_\d+/i,
  /^DSC_?\d+/i,
  /^DCIM/i,
  /^PXL_\d+/i, // Google Pixel
  /^Screen Recording/i,
  /^\d{4}-\d{2}-\d{2}/,
  /^20\d{6}_\d{6}/, // Timestamp format: 20240315_143022
];

/** Filename keywords suggesting audiobook content. */
const AUDIOBOOK_KEYWORDS = [
  'audiobook',
  'chapter',
  'narrat',
  'unabridged',
  'abridged',
  'disc',
  'part',
  'book',
];

/** Folder name patterns that strongly suggest audiobooks. */
const AUDIOBOOK_FOLDER_PATTERNS = [
  /audiobook/i,
  /narrat/i,
  /unabridged/i,
  /abridged/i,
  /librivox/i,
  /audible/i,
];

/** Screenshot detection: common screen resolutions. */
const SCREENSHOT_RESOLUTIONS = [
  '1920x1080',
  '2560x1440',
  '3840x2160',
  '1440x900',
  '2880x1800',
  '1366x768',
  '1536x2048', // iPad
  '1170x2532', // iPhone
  '1284x2778', // iPhone Pro Max
];

// ─── Classification logic ────────────────────────────────────────────

/**
 * Classify a single file based on filename, MIME type, size, and folder
 * context. This is the fast, client-side heuristic — no LLM involved.
 *
 * The optional `relativePath` enables folder-aware classification:
 * folder names like `Audiobooks/Author Name/Book Title/` dramatically
 * increase confidence for audiobook detection.
 */
export function classifyFile(
  filename: string,
  mimeType: string,
  sizeBytes: number,
  relativePath?: string,
): ClassificationResult {
  const ext = getExtension(filename);
  const lower = filename.toLowerCase();
  const folders = getFolderSegments(relativePath);
  const parentFolder = getParentFolder(relativePath);

  // Check if any folder in the path suggests audiobooks
  const folderSuggestsAudiobook = folders.some((folder) =>
    AUDIOBOOK_FOLDER_PATTERNS.some((pattern) => pattern.test(folder)),
  );

  // ── Photo extensions ──
  if (['jpg', 'jpeg', 'heic', 'png', 'webp', 'raw', 'dng', 'cr2', 'arw', 'nef', 'orf'].includes(ext)) {
    return { service: 'photos', confidence: 0.95 };
  }

  // ── Screenshots (PNG with screenshot-like names) ──
  if (ext === 'png' && /screenshot/i.test(lower)) {
    return { service: 'photos', confidence: 0.95 };
  }

  // ── Video files — nuanced classification ──
  if (['mp4', 'mov', 'mkv', 'avi', 'wmv', 'webm', 'flv', 'm4v', 'ts'].includes(ext)) {
    return classifyVideo(filename, ext, sizeBytes, parentFolder);
  }

  // ── Audiobook: M4B is always an audiobook ──
  if (ext === 'm4b') {
    return { service: 'audiobooks', confidence: 0.98 };
  }

  // ── Audio files — music vs audiobook disambiguation ──
  if (['mp3', 'flac', 'ogg', 'aac', 'wma', 'opus', 'm4a', 'wav'].includes(ext)) {
    return classifyAudio(filename, lower, sizeBytes, folderSuggestsAudiobook, parentFolder);
  }

  // ── Documents ──
  if (['pdf', 'docx', 'doc', 'xlsx', 'xls', 'odt', 'ods', 'pptx', 'ppt', 'txt', 'rtf', 'csv', 'epub'].includes(ext)) {
    // EPUBs could be audiobook companions but are documents
    return { service: 'documents', confidence: 0.92 };
  }

  // ── Generic MIME fallbacks ──
  if (mimeType.startsWith('image/')) {
    return { service: 'photos', confidence: 0.9 };
  }

  if (mimeType.startsWith('video/')) {
    return classifyVideo(filename, ext, sizeBytes, parentFolder);
  }

  if (mimeType.startsWith('audio/')) {
    return classifyAudio(filename, lower, sizeBytes, folderSuggestsAudiobook, parentFolder);
  }

  // ── Everything else goes to files ──
  return { service: 'files', confidence: 1.0 };
}

/** Classify a video file as photos (personal) vs media (movie/TV). */
function classifyVideo(
  filename: string,
  _ext: string,
  sizeBytes: number,
  parentFolder: string | undefined,
): ClassificationResult {
  // TV episode pattern is a strong signal
  if (TV_EPISODE_PATTERN.test(filename)) {
    return { service: 'media', confidence: 0.92 };
  }

  // Scene release / movie rip patterns
  if (MOVIE_RELEASE_PATTERN.test(filename)) {
    return { service: 'media', confidence: 0.9 };
  }

  // Home video naming patterns (camera auto-names)
  if (HOME_VIDEO_PATTERNS.some((pattern) => pattern.test(filename))) {
    return { service: 'photos', confidence: 0.92 };
  }

  // Folder context: "Movies", "TV Shows", "Films"
  if (parentFolder && /^(movies?|films?|tv\s*shows?|series|media)$/i.test(parentFolder)) {
    return { service: 'media', confidence: 0.85 };
  }

  // Size heuristic: very large videos are more likely movies
  if (sizeBytes > SIZE_2GB) {
    return { service: 'media', confidence: 0.75 };
  }

  // Small-medium videos: likely personal
  if (sizeBytes < SIZE_500MB) {
    return { service: 'photos', confidence: 0.7 };
  }

  // Ambiguous — medium-large video, no naming patterns
  // Low confidence so the LLM gets a shot
  return { service: 'media', confidence: 0.6 };
}

/** Classify an audio file as music (media) vs audiobook. */
function classifyAudio(
  _filename: string,
  lowerFilename: string,
  sizeBytes: number,
  folderSuggestsAudiobook: boolean,
  parentFolder: string | undefined,
): ClassificationResult {
  // Folder path says "audiobook" — very strong signal
  if (folderSuggestsAudiobook) {
    return { service: 'audiobooks', confidence: 0.93 };
  }

  // Filename contains audiobook keywords
  const hasAudiobookKeyword = AUDIOBOOK_KEYWORDS.some((kw) => lowerFilename.includes(kw));
  if (hasAudiobookKeyword) {
    return { service: 'audiobooks', confidence: 0.85 };
  }

  // Numbered chapter-like naming: "01 - Title.mp3", "Chapter 1.mp3"
  if (/^(\d{1,3})\s*[-._]\s*/i.test(lowerFilename) || /chapter\s*\d/i.test(lowerFilename)) {
    // Could be music album tracks too — medium confidence
    return { service: 'audiobooks', confidence: 0.6 };
  }

  // Parent folder suggests music: "Music", "Albums", artist-like names
  if (parentFolder && /^(music|albums?|songs?|playlists?)$/i.test(parentFolder)) {
    return { service: 'media', confidence: 0.88 };
  }

  // Large audio files (>100MB) are more likely audiobook chapters
  if (sizeBytes > SIZE_100MB) {
    return { service: 'audiobooks', confidence: 0.7 };
  }

  // Default: music
  return { service: 'media', confidence: 0.8 };
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
