import { useCallback, useRef, useState } from 'react';
import { Button, Select, Progress, Tag, Typography, Collapse, Spin } from 'antd';
import { CloudArrowUp, Check, X, FolderOpen, File as FileIcon, CaretRight } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { SERVICE_LABELS, SERVICE_COLORS, SERVICES, formatFileSize } from '@steadfirm/shared';
import type { ServiceName, AudiobookGroup } from '@steadfirm/shared';
import { colors, cssVar } from '@steadfirm/theme';

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

export interface DropZoneProps {
  files: ClassifiedFile[];
  step: 'select' | 'analyzing' | 'review' | 'upload';
  uploadProgress: Map<string, UploadFileProgress>;
  audiobookGroups?: AudiobookGroup[];
  onFilesSelected: (files: DroppedFile[]) => void;
  onOverride: (index: number, service: ServiceName) => void;
  onConfirm: () => void;
  onReset: () => void;
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

// ─── Folder traversal helpers ────────────────────────────────────────

/** Recursively read all files from a FileSystemDirectoryEntry. */
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

/** Convert a FileSystemFileEntry to a File with its relative path. */
function entryToFile(entry: FileSystemFileEntry): Promise<DroppedFile> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => {
        // fullPath starts with `/`, strip the leading slash
        const relativePath = entry.fullPath.replace(/^\//, '');
        resolve({ file, relativePath });
      },
      reject,
    );
  });
}

/** Recursively collect all files from a FileSystemEntry tree. Skips zip files. */
async function collectFilesFromEntry(entry: FileSystemEntry): Promise<DroppedFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    // Leave zip files alone — drop them as-is without recursing
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

/** Collect all files from a drop event, supporting both files and folders. */
async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  const items = dataTransfer.items;
  const results: DroppedFile[] = [];

  // Try webkitGetAsEntry first for folder support
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
    // Fallback: no webkitGetAsEntry support, use regular files
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

/** Collect files from a file input change event (including directory picks). */
function collectInputFiles(fileList: FileList): DroppedFile[] {
  const results: DroppedFile[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (file) {
      // webkitRelativePath is set when using directory picker
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

      {/* Hidden file inputs */}
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

// ─── Analyzing Step ──────────────────────────────────────────────────

function AnalyzingStep({ fileCount }: { fileCount: number }) {
  return (
    <motion.div
      key="analyzing"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        maxWidth: 600,
        margin: '0 auto',
        padding: '80px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      <Spin size="large" />
      <Typography.Title level={4} style={{ margin: 0 }}>
        Analyzing {fileCount} {fileCount === 1 ? 'file' : 'files'}...
      </Typography.Title>
      <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
        Classifying files and detecting audiobook groupings.
        <br />
        This may take a moment for large uploads.
      </Typography.Text>
    </motion.div>
  );
}

// ─── Review Step (grouped by service) ────────────────────────────────

function ReviewStep({
  files,
  audiobookGroups,
  onOverride,
  onConfirm,
  onReset,
}: {
  files: ClassifiedFile[];
  audiobookGroups?: AudiobookGroup[];
  onOverride: (index: number, service: ServiceName) => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
  // Group files by service
  const grouped = new Map<ServiceName, { file: ClassifiedFile; index: number }[]>();
  files.forEach((file, index) => {
    const existing = grouped.get(file.service) ?? [];
    existing.push({ file, index });
    grouped.set(file.service, existing);
  });

  // Sort services in the canonical order
  const orderedServices = SERVICES.filter((s) => grouped.has(s));

  return (
    <motion.div
      key="review"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ maxWidth: 700, margin: '0 auto', padding: '24px 16px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Review classifications
        </Typography.Title>
        <Typography.Text type="secondary">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </Typography.Text>
      </div>

      {/* Audiobook groupings banner */}
      {audiobookGroups && audiobookGroups.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            borderRadius: 8,
            background: `${SERVICE_COLORS.audiobooks}15`,
            border: `1px solid ${SERVICE_COLORS.audiobooks}40`,
          }}
        >
          <Typography.Text strong style={{ fontSize: 13 }}>
            Detected {audiobookGroups.length} audiobook{audiobookGroups.length > 1 ? 's' : ''}:
          </Typography.Text>
          {audiobookGroups.map((group, i) => (
            <div key={i} style={{ fontSize: 12, marginTop: 4, color: 'var(--ant-color-text-secondary)' }}>
              <CaretRight size={10} weight="bold" style={{ marginRight: 4 }} />
              {group.author ? `${group.author} — ` : ''}{group.title}
              {' '}({group.fileIndices.length} file{group.fileIndices.length > 1 ? 's' : ''})
            </div>
          ))}
        </div>
      )}

      {/* Grouped by service */}
      <Collapse
        defaultActiveKey={orderedServices}
        style={{ marginBottom: 24 }}
        items={orderedServices.map((service) => {
          const items = grouped.get(service) ?? [];
          return {
            key: service,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={SERVICE_COLORS[service]} style={{ margin: 0, fontSize: 12 }}>
                  {SERVICE_LABELS[service]}
                </Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {items.length} {items.length === 1 ? 'file' : 'files'}
                </Typography.Text>
              </div>
            ),
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(({ file: item, index }) => (
                  <div
                    key={`${item.file.name}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      border: '1px solid var(--ant-color-border)',
                      borderRadius: 6,
                      background: 'var(--ant-color-bg-container)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: 13,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.relativePath ?? item.file.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginTop: 1 }}>
                        {formatFileSize(item.file.size)}
                        {item.reasoning && (
                          <span style={{ marginLeft: 8, fontStyle: 'italic' }}>
                            — {item.reasoning}
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--ant-color-text-tertiary)',
                        minWidth: 36,
                        textAlign: 'right',
                      }}
                    >
                      {Math.round(item.confidence * 100)}%
                    </div>

                    <Select
                      size="small"
                      value={item.service}
                      onChange={(value) => onOverride(index, value)}
                      options={serviceOptions}
                      style={{ width: 130 }}
                      popupMatchSelectWidth={false}
                    />
                  </div>
                ))}
              </div>
            ),
          };
        })}
      />

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onReset}>Cancel</Button>
        <Button
          type="primary"
          onClick={onConfirm}
          style={{ background: cssVar.accent, borderColor: cssVar.accent }}
        >
          Upload All
        </Button>
      </div>
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
  onFilesSelected,
  onOverride,
  onConfirm,
  onReset,
}: DropZoneProps) {
  return (
    <AnimatePresence mode="wait">
      {step === 'select' && <SelectStep onFilesSelected={onFilesSelected} />}
      {step === 'analyzing' && <AnalyzingStep fileCount={files.length} />}
      {step === 'review' && (
        <ReviewStep
          files={files}
          audiobookGroups={audiobookGroups}
          onOverride={onOverride}
          onConfirm={onConfirm}
          onReset={onReset}
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
