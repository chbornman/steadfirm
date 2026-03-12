import { useCallback, useRef, useState } from 'react';
import { Button, Select, Progress, Tag, Typography, Spin } from 'antd';
import {
  CloudArrowUp,
  Check,
  X,
  FolderOpen,
  File as FileIcon,
  CaretRight,
  Image,
  FilmSlate,
  FileText,
  Headphones,
  BookOpen,
  HardDrives,
  CircleNotch,
  Sparkle,
} from '@phosphor-icons/react';
import { AnimatePresence, motion, LayoutGroup } from 'framer-motion';
import { SERVICE_LABELS, SERVICE_COLORS, SERVICES, formatFileSize } from '@steadfirm/shared';
import type { ServiceName, AudiobookGroup } from '@steadfirm/shared';
import { colors, cssVar } from '@steadfirm/theme';
import { AudiobookReviewPanel } from './AudiobookReviewPanel';
import type { AudiobookGroupEditable } from './AudiobookReviewPanel';
import { TvShowReviewPanel } from './TvShowReviewPanel';
import type { TvShowGroupEditable } from './TvShowReviewPanel';
import { MovieReviewPanel } from './MovieReviewPanel';
import type { MovieGroupEditable } from './MovieReviewPanel';
import { MusicReviewPanel } from './MusicReviewPanel';
import type { MusicAlbumGroupEditable } from './MusicReviewPanel';
import { ReadingReviewPanel } from './ReadingReviewPanel';
import type { ReadingGroupEditable } from './ReadingReviewPanel';

// ─── Types ───────────────────────────────────────────────────────────

/** A file with its relative path (from a folder drop). */
export interface DroppedFile {
  file: File;
  /** e.g. `Brandon Sanderson/Mistborn/chapter01.mp3`. Undefined for loose files. */
  relativePath?: string;
}

export interface ClassifiedFile {
  file: File;
  service: ServiceName;
  confidence: number;
  /** Relative path within a dropped folder. */
  relativePath?: string;
  /** Short reasoning from AI classification. */
  reasoning?: string;
  /** Whether this file was classified by the LLM. */
  aiClassified?: boolean;
}

export interface UploadFileProgress {
  progress: number;
  status: 'uploading' | 'done' | 'error';
}

/** A streamed classification result (one per file). */
export interface StreamedClassification {
  index: number;
  service: ServiceName;
  confidence: number;
  reasoning?: string;
  aiClassified: boolean;
}

export type StreamingPhase =
  | 'idle'
  | 'connecting'
  | 'heuristics'
  | 'classifying'
  | 'done'
  | 'error';

export interface DropZoneProps {
  files: ClassifiedFile[];
  step: 'select' | 'streaming' | 'review' | 'upload';
  uploadProgress: Map<string, UploadFileProgress>;
  audiobookGroups?: AudiobookGroupEditable[];
  tvShowGroups?: TvShowGroupEditable[];
  movieGroups?: MovieGroupEditable[];
  musicGroups?: MusicAlbumGroupEditable[];
  readingGroups?: ReadingGroupEditable[];
  onFilesSelected: (files: DroppedFile[]) => void;
  onOverride: (index: number, service: ServiceName) => void;
  onConfirm: () => void;
  onReset: () => void;
  // Streaming props
  /** All dropped files (before classification). */
  droppedFiles?: DroppedFile[];
  /** Map of file index → classification result (populated progressively). */
  streamedClassifications?: Map<number, StreamedClassification>;
  /** Current streaming phase. */
  streamingPhase?: StreamingPhase;
  /** Number of files pending LLM classification. */
  pendingCount?: number;
  /** Called when the user edits audiobook group metadata. */
  onAudiobookGroupChange?: (groupIndex: number, updates: Partial<AudiobookGroupEditable>) => void;
  /** Called when the user edits TV show group metadata. */
  onTvShowGroupChange?: (groupIndex: number, updates: Partial<TvShowGroupEditable>) => void;
  /** Called when the user edits movie group metadata. */
  onMovieGroupChange?: (groupIndex: number, updates: Partial<MovieGroupEditable>) => void;
  /** Called when the user edits music group metadata. */
  onMusicGroupChange?: (groupIndex: number, updates: Partial<MusicAlbumGroupEditable>) => void;
  /** Called when the user edits reading group metadata. */
  onReadingGroupChange?: (groupIndex: number, updates: Partial<ReadingGroupEditable>) => void;
  /** Whether audio files are being probed for metadata. */
  isProbing?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────

const reclassifyServices = SERVICES.filter((s) => s !== 'files');

const serviceOptions = reclassifyServices.map((s) => ({
  value: s,
  label: SERVICE_LABELS[s],
}));

const stepVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } },
};

const SERVICE_ICONS: Record<ServiceName, React.ReactNode> = {
  photos: <Image size={18} weight="duotone" />,
  media: <FilmSlate size={18} weight="duotone" />,
  documents: <FileText size={18} weight="duotone" />,
  audiobooks: <Headphones size={18} weight="duotone" />,
  reading: <BookOpen size={18} weight="duotone" />,
  files: <HardDrives size={18} weight="duotone" />,
};

// ─── Folder traversal helpers ────────────────────────────────────────

function readDirectoryEntries(
  dirReader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const allEntries: FileSystemEntry[] = [];
    const readBatch = () => {
      dirReader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(allEntries);
        } else {
          allEntries.push(...entries);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function entryToFile(entry: FileSystemFileEntry): Promise<DroppedFile> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => {
        const relativePath = entry.fullPath.replace(/^\//, '');
        resolve({ file, relativePath });
      },
      reject,
    );
  });
}

async function collectFilesFromEntry(entry: FileSystemEntry): Promise<DroppedFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    if (fileEntry.name.toLowerCase().endsWith('.zip')) {
      const dropped = await entryToFile(fileEntry);
      return [dropped];
    }
    return [await entryToFile(fileEntry)];
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const entries = await readDirectoryEntries(reader);
    const nested = await Promise.all(entries.map(collectFilesFromEntry));
    return nested.flat();
  }

  return [];
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  const items = dataTransfer.items;
  const results: DroppedFile[] = [];

  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.kind === 'file') {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map(collectFilesFromEntry));
    results.push(...nested.flat());
  } else {
    const files = dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) {
        results.push({ file });
      }
    }
  }

  return results;
}

function collectInputFiles(fileList: FileList): DroppedFile[] {
  const results: DroppedFile[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (file) {
      const relativePath = file.webkitRelativePath || undefined;
      results.push({ file, relativePath });
    }
  }
  return results;
}

// ─── Select Step ─────────────────────────────────────────────────────

function SelectStep({
  onFilesSelected,
}: {
  onFilesSelected: (files: DroppedFile[]) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = await collectDroppedFiles(e.dataTransfer);
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [onFilesSelected],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = collectInputFiles(e.target.files);
        if (files.length > 0) {
          onFilesSelected(files);
        }
      }
    },
    [onFilesSelected],
  );

  return (
    <motion.div
      key="select"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ maxWidth: 600, margin: '0 auto', padding: '48px 16px' }}
    >
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          padding: '48px 24px',
          borderColor: isDragOver ? cssVar.accent : 'var(--sf-dropzone-border)',
          borderStyle: 'dashed',
          borderWidth: 2,
          borderRadius: 12,
          background: isDragOver
            ? 'var(--sf-dropzone-border)'
            : 'var(--sf-dropzone-bg)',
          transition: 'border-color 0.2s, background 0.2s',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <CloudArrowUp size={56} weight="duotone" color={cssVar.accent} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            Drop files or folders here
          </Typography.Title>
          <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
            Files will be automatically classified and routed to the right service.
            <br />
            Folders will be recursively scanned.
          </Typography.Text>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <Button
              icon={<FileIcon size={16} />}
              onClick={() => fileInputRef.current?.click()}
            >
              Browse Files
            </Button>
            <Button
              icon={<FolderOpen size={16} />}
              onClick={() => folderInputRef.current?.click()}
            >
              Browse Folder
            </Button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
    </motion.div>
  );
}

// ─── Streaming Step (category buckets fill in real-time) ─────────────

function StreamingStep({
  droppedFiles,
  classifications,
  streamingPhase,
  pendingCount,
  audiobookGroups,
  tvShowGroups,
  movieGroups,
  musicGroups,
  readingGroups,
  onOverride,
  onConfirm,
  onReset,
  onAudiobookGroupChange,
  onTvShowGroupChange,
  onMovieGroupChange,
  onMusicGroupChange,
  onReadingGroupChange,
  isProbing,
}: {
  droppedFiles: DroppedFile[];
  classifications: Map<number, StreamedClassification>;
  streamingPhase: StreamingPhase;
  pendingCount: number;
  audiobookGroups?: AudiobookGroupEditable[];
  tvShowGroups?: TvShowGroupEditable[];
  movieGroups?: MovieGroupEditable[];
  musicGroups?: MusicAlbumGroupEditable[];
  readingGroups?: ReadingGroupEditable[];
  onOverride: (index: number, service: ServiceName) => void;
  onConfirm: () => void;
  onReset: () => void;
  onAudiobookGroupChange?: (groupIndex: number, updates: Partial<AudiobookGroupEditable>) => void;
  onTvShowGroupChange?: (groupIndex: number, updates: Partial<TvShowGroupEditable>) => void;
  onMovieGroupChange?: (groupIndex: number, updates: Partial<MovieGroupEditable>) => void;
  onMusicGroupChange?: (groupIndex: number, updates: Partial<MusicAlbumGroupEditable>) => void;
  onReadingGroupChange?: (groupIndex: number, updates: Partial<ReadingGroupEditable>) => void;
  isProbing?: boolean;
}) {
  const isDone = streamingPhase === 'done' || streamingPhase === 'error';
  const isClassifying = streamingPhase === 'classifying';
  const classifiedCount = classifications.size;
  const totalCount = droppedFiles.length;

  // Group classified files by service
  const buckets = new Map<ServiceName, Array<{ index: number; dropped: DroppedFile; classification: StreamedClassification }>>();
  for (const [index, classification] of classifications) {
    const dropped = droppedFiles[index];
    if (!dropped) continue;
    const existing = buckets.get(classification.service) ?? [];
    existing.push({ index, dropped, classification });
    buckets.set(classification.service, existing);
  }

  // Collect unclassified file indices
  const unclassifiedIndices: number[] = [];
  for (let i = 0; i < droppedFiles.length; i++) {
    if (!classifications.has(i)) {
      unclassifiedIndices.push(i);
    }
  }

  const orderedServices = SERVICES.filter((s) => buckets.has(s));

  return (
    <motion.div
      key="streaming"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ maxWidth: 700, margin: '0 auto', padding: '24px 16px' }}
    >
      {/* Header with progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {isDone ? 'Review classifications' : 'Classifying files'}
          </Typography.Title>
          {!isDone && (
            <Spin size="small" />
          )}
        </div>
        <Typography.Text type="secondary">
          {classifiedCount} / {totalCount} classified
        </Typography.Text>
      </div>

      {/* Progress bar */}
      {!isDone && (
        <Progress
          percent={Math.round((classifiedCount / totalCount) * 100)}
          showInfo={false}
          strokeColor={cssVar.accent}
          style={{ marginBottom: 16 }}
          size="small"
        />
      )}

      {/* AI classifying indicator */}
      {isClassifying && pendingCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            marginBottom: 16,
            borderRadius: 6,
            background: `${cssVar.accent}12`,
            border: `1px solid ${cssVar.accent}30`,
            fontSize: 12,
          }}
        >
          <Sparkle size={14} weight="fill" color={cssVar.accent} />
          <Typography.Text style={{ fontSize: 12 }}>
            AI is classifying {pendingCount} ambiguous {pendingCount === 1 ? 'file' : 'files'}...
          </Typography.Text>
        </div>
      )}

      {/* Review panels for detected groups */}
      {isDone && (() => {
        const fileNamesMap = new Map(
          droppedFiles.map((d, i) => [
            i,
            { name: d.file.name, size: d.file.size, relativePath: d.relativePath },
          ] as const),
        );
        return (
          <>
            {audiobookGroups && audiobookGroups.length > 0 && (
              <AudiobookReviewPanel
                groups={audiobookGroups}
                fileNames={fileNamesMap}
                onGroupChange={onAudiobookGroupChange ?? (() => {})}
                isProbing={isProbing}
              />
            )}
            {tvShowGroups && tvShowGroups.length > 0 && (
              <TvShowReviewPanel
                groups={tvShowGroups}
                fileNames={fileNamesMap}
                onGroupChange={onTvShowGroupChange ?? (() => {})}
              />
            )}
            {movieGroups && movieGroups.length > 0 && (
              <MovieReviewPanel
                groups={movieGroups}
                fileNames={fileNamesMap}
                onGroupChange={onMovieGroupChange ?? (() => {})}
              />
            )}
            {musicGroups && musicGroups.length > 0 && (
              <MusicReviewPanel
                groups={musicGroups}
                fileNames={fileNamesMap}
                onGroupChange={onMusicGroupChange ?? (() => {})}
                isProbing={isProbing}
              />
            )}
            {readingGroups && readingGroups.length > 0 && (
              <ReadingReviewPanel
                groups={readingGroups}
                fileNames={fileNamesMap}
                onGroupChange={onReadingGroupChange ?? (() => {})}
              />
            )}
          </>
        );
      })()}

      {/* Category buckets */}
      <LayoutGroup>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {orderedServices.map((service) => {
            const items = buckets.get(service) ?? [];
            return (
              <ServiceBucket
                key={service}
                service={service}
                items={items}
                isDone={isDone}
                onOverride={onOverride}
              />
            );
          })}

          {/* Unclassified files (waiting for LLM) */}
          {unclassifiedIndices.length > 0 && (
            <motion.div
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                borderRadius: 8,
                border: '1px dashed var(--ant-color-border)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  background: 'var(--ant-color-bg-layout)',
                }}
              >
                <CircleNotch size={16} weight="bold" style={{ animation: 'spin 1s linear infinite' }} />
                <Typography.Text strong style={{ fontSize: 13 }}>
                  Pending
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {unclassifiedIndices.length} {unclassifiedIndices.length === 1 ? 'file' : 'files'}
                </Typography.Text>
              </div>
              <div style={{ padding: '4px 8px' }}>
                {unclassifiedIndices.map((idx) => {
                  const dropped = droppedFiles[idx];
                  if (!dropped) return null;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        fontSize: 12,
                        color: 'var(--ant-color-text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <FileIcon size={12} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {dropped.relativePath ?? dropped.file.name}
                      </span>
                      <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                        {formatFileSize(dropped.file.size)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>
      </LayoutGroup>

      {/* Actions */}
      {isDone && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}
        >
          <Button onClick={onReset}>Cancel</Button>
          <Button
            type="primary"
            onClick={onConfirm}
            style={{ background: cssVar.accent, borderColor: cssVar.accent }}
          >
            Upload All
          </Button>
        </motion.div>
      )}

      {/* Spin animation keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </motion.div>
  );
}

// ─── Service Bucket ──────────────────────────────────────────────────

function ServiceBucket({
  service,
  items,
  isDone,
  onOverride,
}: {
  service: ServiceName;
  items: Array<{ index: number; dropped: DroppedFile; classification: StreamedClassification }>;
  isDone: boolean;
  onOverride: (index: number, service: ServiceName) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const color = SERVICE_COLORS[service];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      style={{
        borderRadius: 8,
        border: `1px solid ${color}40`,
        overflow: 'hidden',
      }}
    >
      {/* Bucket header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          background: `${color}10`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ color, display: 'flex', alignItems: 'center' }}>
          {SERVICE_ICONS[service]}
        </span>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {SERVICE_LABELS[service]}
        </Typography.Text>
        <Tag
          color={color}
          style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
        >
          {items.length}
        </Tag>
        <CaretRight
          size={12}
          weight="bold"
          style={{
            marginLeft: 'auto',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            color: 'var(--ant-color-text-tertiary)',
          }}
        />
      </div>

      {/* File list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div style={{ padding: '4px 8px' }}>
              <AnimatePresence initial={false}>
                {items.map(({ index, dropped, classification }) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {dropped.relativePath ?? dropped.file.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginTop: 1 }}>
                          {formatFileSize(dropped.file.size)}
                          {classification.reasoning && (
                            <span style={{ marginLeft: 8, fontStyle: 'italic' }}>
                              — {classification.reasoning}
                            </span>
                          )}
                        </div>
                      </div>

                      {classification.aiClassified && (
                        <Tag
                          style={{
                            margin: 0,
                            fontSize: 10,
                            lineHeight: '16px',
                            padding: '0 4px',
                            background: `${cssVar.accent}15`,
                            border: `1px solid ${cssVar.accent}30`,
                            color: cssVar.accent,
                          }}
                        >
                          AI
                        </Tag>
                      )}

                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--ant-color-text-tertiary)',
                          minWidth: 30,
                          textAlign: 'right',
                        }}
                      >
                        {Math.round(classification.confidence * 100)}%
                      </div>

                      {isDone && (
                        <Select
                          size="small"
                          value={classification.service}
                          onChange={(value) => onOverride(index, value)}
                          options={serviceOptions}
                          style={{ width: 130 }}
                          popupMatchSelectWidth={false}
                        />
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Upload Step ─────────────────────────────────────────────────────

function UploadStep({
  files,
  uploadProgress,
  onReset,
}: {
  files: ClassifiedFile[];
  uploadProgress: Map<string, UploadFileProgress>;
  onReset: () => void;
}) {
  const allDone = files.every((f) => {
    const key = f.relativePath ?? f.file.name;
    const progress = uploadProgress.get(key);
    return progress && (progress.status === 'done' || progress.status === 'error');
  });

  const doneCount = files.filter((f) => {
    const key = f.relativePath ?? f.file.name;
    return uploadProgress.get(key)?.status === 'done';
  }).length;
  const errorCount = files.filter((f) => {
    const key = f.relativePath ?? f.file.name;
    return uploadProgress.get(key)?.status === 'error';
  }).length;

  return (
    <motion.div
      key="upload"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ maxWidth: 700, margin: '0 auto', padding: '24px 16px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Uploading files
        </Typography.Title>
        {allDone && (
          <Typography.Text type="secondary">
            {doneCount} completed{errorCount > 0 ? `, ${errorCount} failed` : ''}
          </Typography.Text>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {files.map((item, index) => {
          const key = item.relativePath ?? item.file.name;
          const progress = uploadProgress.get(key);
          const status = progress?.status ?? 'uploading';
          const percent = progress?.progress ?? 0;

          return (
            <div
              key={`${key}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                border: '1px solid var(--ant-color-border)',
                borderRadius: 8,
                background: 'var(--ant-color-bg-container)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginBottom: 4,
                  }}
                >
                  {item.relativePath ?? item.file.name}
                </div>
                <Progress
                  percent={percent}
                  size="small"
                  showInfo={false}
                  status={status === 'error' ? 'exception' : status === 'done' ? 'success' : 'active'}
                  strokeColor={status === 'uploading' ? cssVar.accent : undefined}
                />
              </div>

              <Tag
                color={SERVICE_COLORS[item.service]}
                style={{ margin: 0, fontSize: 12 }}
              >
                {SERVICE_LABELS[item.service]}
              </Tag>

              <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {status === 'done' && <Check size={18} weight="bold" color={colors.success} />}
                {status === 'error' && <X size={18} weight="bold" color={colors.error} />}
              </div>
            </div>
          );
        })}
      </div>

      {allDone && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            onClick={onReset}
            style={{ background: cssVar.accent, borderColor: cssVar.accent }}
          >
            Upload More
          </Button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────

export function DropZone({
  files,
  step,
  uploadProgress,
  audiobookGroups,
  tvShowGroups,
  movieGroups,
  musicGroups,
  readingGroups,
  onFilesSelected,
  onOverride,
  onConfirm,
  onReset,
  droppedFiles,
  streamedClassifications,
  streamingPhase,
  pendingCount,
  onAudiobookGroupChange,
  onTvShowGroupChange,
  onMovieGroupChange,
  onMusicGroupChange,
  onReadingGroupChange,
  isProbing,
}: DropZoneProps) {
  return (
    <AnimatePresence mode="wait">
      {step === 'select' && <SelectStep onFilesSelected={onFilesSelected} />}
      {step === 'streaming' && droppedFiles && streamedClassifications && streamingPhase && (
        <StreamingStep
          droppedFiles={droppedFiles}
          classifications={streamedClassifications}
          streamingPhase={streamingPhase}
          pendingCount={pendingCount ?? 0}
          audiobookGroups={audiobookGroups}
          tvShowGroups={tvShowGroups}
          movieGroups={movieGroups}
          musicGroups={musicGroups}
          readingGroups={readingGroups}
          onOverride={onOverride}
          onConfirm={onConfirm}
          onReset={onReset}
          onAudiobookGroupChange={onAudiobookGroupChange}
          onTvShowGroupChange={onTvShowGroupChange}
          onMovieGroupChange={onMovieGroupChange}
          onMusicGroupChange={onMusicGroupChange}
          onReadingGroupChange={onReadingGroupChange}
          isProbing={isProbing}
        />
      )}
      {step === 'review' && (
        <StreamingStep
          droppedFiles={droppedFiles ?? files.map((f) => ({ file: f.file, relativePath: f.relativePath }))}
          classifications={
            streamedClassifications ??
            new Map(files.map((f, i) => [i, {
              index: i,
              service: f.service,
              confidence: f.confidence,
              reasoning: f.reasoning,
              aiClassified: f.aiClassified ?? false,
            }]))
          }
          streamingPhase="done"
          pendingCount={0}
          audiobookGroups={audiobookGroups}
          tvShowGroups={tvShowGroups}
          movieGroups={movieGroups}
          musicGroups={musicGroups}
          readingGroups={readingGroups}
          onOverride={onOverride}
          onConfirm={onConfirm}
          onReset={onReset}
          onAudiobookGroupChange={onAudiobookGroupChange}
          onTvShowGroupChange={onTvShowGroupChange}
          onMovieGroupChange={onMovieGroupChange}
          onMusicGroupChange={onMusicGroupChange}
          onReadingGroupChange={onReadingGroupChange}
          isProbing={isProbing}
        />
      )}
      {step === 'upload' && (
        <UploadStep
          files={files}
          uploadProgress={uploadProgress}
          onReset={onReset}
        />
      )}
    </AnimatePresence>
  );
}
