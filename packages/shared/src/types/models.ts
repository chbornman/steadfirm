export interface Photo {
  id: string;
  type: 'image' | 'video';
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  dateTaken: string;
  isFavorite: boolean;
  duration?: number;
  thumbnailUrl: string;
}

export interface Movie {
  id: string;
  title: string;
  year: number;
  runtime: number;
  overview: string;
  rating?: string;
  imageUrl: string;
  streamUrl: string;
}

export interface TvShow {
  id: string;
  title: string;
  year: string;
  overview: string;
  seasonCount: number;
  imageUrl: string;
}

export interface Season {
  id: string;
  name: string;
  seasonNumber: number;
  episodeCount: number;
}

export interface Episode {
  id: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  runtime: number;
  overview: string;
  imageUrl: string;
  streamUrl: string;
}

export interface Artist {
  id: string;
  name: string;
  imageUrl: string;
  albumCount?: number;
}

export interface Album {
  id: string;
  name: string;
  year?: number;
  artistName?: string;
  trackCount?: number;
  imageUrl: string;
}

export interface Track {
  id: string;
  title: string;
  trackNumber?: number;
  duration?: number;
  artistName?: string;
  albumName?: string;
  albumImageUrl?: string;
  streamUrl: string;
}

export interface Document {
  id: string;
  title: string;
  correspondent?: string;
  tags: string[];
  dateCreated: string;
  dateAdded: string;
  pageCount?: number;
  mimeType?: string;
  originalFileName?: string;
  /** Whether Paperless has an archived (PDF) version of the document. */
  hasArchiveVersion: boolean;
  thumbnailUrl: string;
  previewUrl: string;
  downloadUrl: string;
}

export interface Audiobook {
  id: string;
  title: string;
  author: string;
  narrator?: string;
  duration: number;
  coverUrl: string;
  progress?: number;
}

export interface Chapter {
  id: string;
  title: string;
  start: number;
  end: number;
}

export interface Series {
  id: string;
  name: string;
  libraryId: number;
  coverUrl: string;
  pages: number;
  format: string;
  pagesRead: number;
}

// ─── Reader types (from Kavita) ──────────────────────────────────────

export interface Volume {
  id: number;
  minNumber: number;
  maxNumber: number;
  name: string | null;
  pages: number;
  pagesRead: number;
  seriesId: number;
  chapters: ChapterInfo[];
  wordCount: number;
}

/** Kavita chapter within a volume. */
export interface ChapterInfo {
  id: number;
  range: string | null;
  minNumber: number;
  maxNumber: number;
  sortOrder: number;
  pages: number;
  pagesRead: number;
  isSpecial: boolean;
  title: string | null;
  titleName: string | null;
  volumeId: number;
  volumeTitle: string | null;
  format: number | null;
}

/** Returned by /chapter/{id}/info — metadata for opening a reader. */
export interface ReaderChapterInfo {
  chapterNumber: string;
  volumeNumber: string;
  volumeId: number;
  seriesName: string;
  seriesFormat: number;
  seriesId: number;
  libraryId: number;
  libraryType: number;
  chapterTitle: string | null;
  pages: number;
  fileName: string;
  isSpecial: boolean;
  subtitle: string;
  title: string;
  pageDimensions: PageDimension[] | null;
}

export interface PageDimension {
  width: number;
  height: number;
  pageNumber: number;
  isWide: boolean;
}

/** Returned by /book/{id}/info — EPUB/PDF metadata. */
export interface BookInfo {
  bookTitle: string;
  seriesId: number;
  volumeId: number;
  seriesFormat: number;
  seriesName: string;
  chapterNumber: string;
  volumeNumber: string;
  libraryId: number;
  pages: number;
  isSpecial: boolean;
  chapterTitle: string;
}

/** EPUB table of contents entry. */
export interface BookTocEntry {
  title: string;
  part: string | null;
  page: number;
  children: BookTocEntry[];
}

/** Reading progress for a chapter. */
export interface ReadingProgress {
  volumeId: number;
  chapterId: number;
  pageNum: number;
  seriesId: number;
  libraryId: number;
  bookScrollId: string | null;
  lastModifiedUtc: string;
}

export interface UserFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}
