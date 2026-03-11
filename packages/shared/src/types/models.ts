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
  albumCount: number;
}

export interface Album {
  id: string;
  name: string;
  year: number;
  artistName: string;
  trackCount: number;
  imageUrl: string;
}

export interface Track {
  id: string;
  title: string;
  trackNumber: number;
  duration: number;
  artistName: string;
  albumName: string;
  albumImageUrl: string;
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

export interface UserFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}
