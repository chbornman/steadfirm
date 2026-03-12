import type { ServiceName } from '../constants';

// ─── Request ─────────────────────────────────────────────────────────

/** A batch of files to classify via POST /api/v1/classify. */
export interface ClassifyRequest {
  files: FileEntry[];
}

/**
 * Metadata for a single file being classified.
 * Everything the backend needs without the actual bytes.
 */
export interface FileEntry {
  /** Original filename (e.g. `chapter01.mp3`). */
  filename: string;
  /** MIME type as detected by the browser (e.g. `audio/mpeg`). */
  mimeType: string;
  /** File size in bytes. */
  sizeBytes: number;
  /**
   * Relative path within a dropped folder (e.g.
   * `Brandon Sanderson/Mistborn/chapter01.mp3`).
   * Undefined for files dropped individually (not from a folder).
   */
  relativePath?: string;
}

// ─── Response ────────────────────────────────────────────────────────

/** Classification results for the entire batch. */
export interface ClassifyResponse {
  /** One result per file in the request, in the same order. */
  files: FileClassificationResult[];
  /**
   * Detected audiobook groupings. Files classified as `audiobooks`
   * are grouped by inferred book so the upload step can create the
   * correct Author/Title/ folder structure for Audiobookshelf.
   */
  audiobookGroups: AudiobookGroup[];
  /**
   * LLM debug info — only populated when AI classification was used.
   * Contains the prompts sent and raw response so the dev-debug
   * panel can display the full conversation.
   */
  debugInfo?: ClassifyDebugInfo;
}

/** Debug info from an LLM classification call. */
export interface ClassifyDebugInfo {
  /** The system prompt sent to the LLM. */
  systemPrompt: string;
  /** The user prompt sent to the LLM (file metadata JSON). */
  userPrompt: string;
  /** Raw LLM response text (before structured extraction). */
  rawResponse?: string;
  /** Model name used for classification. */
  model: string;
  /** LLM provider used ("anthropic" or "openai"). */
  provider: string;
  /** Number of files sent to the LLM. */
  fileCount: number;
  /** Time taken for the LLM call in milliseconds. */
  durationMs: number;
}

/** Classification result for a single file. */
export interface FileClassificationResult {
  /** Index of this file in the request's files array. */
  index: number;
  /** Destination service. */
  service: ServiceName;
  /** Confidence score (0.0–1.0). */
  confidence: number;
  /** Short human-readable reason for the classification. */
  reasoning?: string;
  /** Whether this file was classified by the LLM. */
  aiClassified: boolean;
}

// ─── Audiobook grouping ──────────────────────────────────────────────

/**
 * A set of files that belong to the same audiobook.
 * Used to create the Author/Title/ folder structure that
 * Audiobookshelf expects.
 */
export interface AudiobookGroup {
  /** Inferred book title (e.g. `Mistborn: The Final Empire`). */
  title: string;
  /** Inferred author name (e.g. `Brandon Sanderson`). */
  author?: string;
  /** Inferred series name (e.g. `Mistborn`). */
  series?: string;
  /** Series sequence/volume number (e.g. `1`, `2.5`). */
  seriesSequence?: string;
  /** Narrator name. */
  narrator?: string;
  /** Publish year (e.g. `2006`). */
  year?: string;
  /** Indices into the request's files array that belong to this book. */
  fileIndices: number[];
  /** Index of the cover image file, if detected in this group. */
  coverIndex?: number;
  /** Probe data extracted from audio files via ffprobe. */
  probeData?: AudiobookProbeData;
}

/** Metadata extracted from audio file ID3/ffprobe tags, aggregated across a group. */
export interface AudiobookProbeData {
  /** Album tag (maps to audiobook title). */
  album?: string;
  /** Artist/album-artist tag (maps to author). */
  artist?: string;
  /** Composer tag (maps to narrator in ABS convention). */
  composer?: string;
  /** Genre tag. */
  genre?: string;
  /** Year/date tag. */
  year?: string;
  /** Series tag (from ID3 MVNM/series tag). */
  series?: string;
  /** Series part (from ID3 MVIN/series-part tag). */
  seriesPart?: string;
  /** Total duration in seconds across all files. */
  totalDurationSecs: number;
  /** Per-file probe results, ordered by track number. */
  tracks: AudioFileProbe[];
}

/** Probe result for a single audio file. */
export interface AudioFileProbe {
  /** Index in the original files array. */
  fileIndex: number;
  /** Track number parsed from ID3 or filename. */
  trackNumber?: number;
  /** Disc number from ID3. */
  discNumber?: number;
  /** Duration of this file in seconds. */
  durationSecs: number;
  /** Title tag from ID3. */
  title?: string;
  /** Whether this file has an embedded cover image. */
  hasEmbeddedCover: boolean;
}
