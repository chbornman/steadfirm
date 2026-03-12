import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Typography } from 'antd';
import { DropZone } from '@steadfirm/ui';
import type { ClassifiedFile, UploadFileProgress, DroppedFile, AudiobookGroupEditable } from '@steadfirm/ui';
import type { ServiceName } from '@steadfirm/shared';
import { uploadFile, uploadAudiobook, probeAudioFiles } from '@/api/upload';
import { useStreamingClassify } from '@/hooks/useStreamingClassify';

/** Map service names to the query key prefixes used by each tab's queries. */
const SERVICE_QUERY_KEYS: Record<ServiceName, string[][]> = {
  photos: [['photos']],
  media: [['media']],
  documents: [['documents']],
  audiobooks: [['audiobooks']],
  reading: [['reading']],
  files: [['files']],
};

type Step = 'select' | 'streaming' | 'upload';

const MAX_CONCURRENT = 3;

export function UploadPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('select');
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Map<string, UploadFileProgress>>(new Map());
  const [audiobookGroupEdits, setAudiobookGroupEdits] = useState<AudiobookGroupEditable[]>([]);
  const [isProbing, setIsProbing] = useState(false);
  const probedRef = useRef(false);

  const streaming = useStreamingClassify();

  // Sync audiobook groups from streaming into editable state
  useEffect(() => {
    const groups = streaming.audiobookGroups;
    if (groups.length > 0 && streaming.phase === 'done') {
      setAudiobookGroupEdits((prev) => {
        // Only initialize if we haven't already (to preserve edits)
        if (prev.length === 0) {
          return groups.map((g) => ({ ...g }));
        }
        return prev;
      });
    }
  }, [streaming.audiobookGroups, streaming.phase]);

  // Auto-probe audiobook files when classification is done
  useEffect(() => {
    const groups = streaming.audiobookGroups;
    if (
      streaming.phase !== 'done' ||
      groups.length === 0 ||
      probedRef.current
    ) {
      return;
    }

    probedRef.current = true;
    setIsProbing(true);

    // Collect all audiobook file indices that are audio files
    const audioExts = new Set(['mp3', 'm4a', 'm4b', 'flac', 'ogg', 'opus', 'aac', 'wma', 'wav']);
    const audioFileIndices = new Set<number>();
    for (const group of groups) {
      for (const idx of group.fileIndices) {
        const file = droppedFiles[idx];
        if (file) {
          const ext = file.file.name.split('.').pop()?.toLowerCase() ?? '';
          if (audioExts.has(ext)) {
            audioFileIndices.add(idx);
          }
        }
      }
    }

    if (audioFileIndices.size === 0) {
      setIsProbing(false);
      return;
    }

    const filesToProbe = [...audioFileIndices]
      .filter((idx) => droppedFiles[idx] != null)
      .map((idx) => ({
        index: idx,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        file: droppedFiles[idx]!.file,
      }));

    void probeAudioFiles(filesToProbe)
      .then((probes) => {
        // Build probe data per group and reorder tracks
        setAudiobookGroupEdits((prev) => {
          return prev.map((group) => {
            const groupProbes = probes.filter((p) =>
              group.fileIndices.includes(p.fileIndex),
            );

            if (groupProbes.length === 0) return group;

            // Sort by disc then track number
            groupProbes.sort((a, b) => {
              const discA = a.discNumber ?? 0;
              const discB = b.discNumber ?? 0;
              if (discA !== discB) return discA - discB;
              return (a.trackNumber ?? 999) - (b.trackNumber ?? 999);
            });

            const totalDuration = groupProbes.reduce(
              (sum, p) => sum + p.durationSecs,
              0,
            );

            // Reorder file indices based on track order
            const sortedIndices = groupProbes.map((p) => p.fileIndex);
            const unprobed = group.fileIndices.filter(
              (idx) => !sortedIndices.includes(idx),
            );

            return {
              ...group,
              fileIndices: [...sortedIndices, ...unprobed],
              probeData: {
                totalDurationSecs: totalDuration,
                tracks: groupProbes,
              },
            };
          });
        });
      })
      .catch((err: unknown) => {
        console.warn('Failed to probe audiobook files:', err);
      })
      .finally(() => {
        setIsProbing(false);
      });
  }, [streaming.phase, streaming.audiobookGroups, droppedFiles]);

  // Build ClassifiedFile[] from streaming results for the upload step
  const classifiedFiles: ClassifiedFile[] = useMemo(() => {
    return droppedFiles.map((dropped, index) => {
      const classification = streaming.classifications.get(index);
      return {
        file: dropped.file,
        service: classification?.service ?? 'files',
        confidence: classification?.confidence ?? 0,
        relativePath: dropped.relativePath,
        reasoning: classification?.reasoning,
        aiClassified: classification?.aiClassified,
      };
    });
  }, [droppedFiles, streaming.classifications]);

  const handleFilesSelected = useCallback(
    (files: DroppedFile[]) => {
      if (files.length === 0) return;

      setDroppedFiles(files);
      setStep('streaming');
      probedRef.current = false;
      setAudiobookGroupEdits([]);

      // Start streaming classification
      const fileEntries = files.map((f) => ({
        filename: f.file.name,
        mimeType: f.file.type,
        sizeBytes: f.file.size,
        relativePath: f.relativePath,
      }));

      streaming.start(fileEntries);
    },
    // streaming.start is stable (useCallback with [] deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming.start],
  );

  const handleOverride = useCallback(
    (index: number, service: ServiceName) => {
      // Update the classification in the streaming state
      streaming.classifications.set(index, {
        index,
        service,
        confidence: 1.0,
        aiClassified: false,
      });
      // Force re-render by updating droppedFiles reference
      setDroppedFiles((prev) => [...prev]);
    },
    [streaming.classifications],
  );

  const handleAudiobookGroupChange = useCallback(
    (groupIndex: number, updates: Partial<AudiobookGroupEditable>) => {
      setAudiobookGroupEdits((prev) => {
        const next = [...prev];
        if (next[groupIndex]) {
          next[groupIndex] = { ...next[groupIndex], ...updates };
        }
        return next;
      });
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    setStep('upload');

    const filesToUpload = classifiedFiles;

    // Separate audiobook files from regular files
    const audiobookFileIndices = new Set<number>();
    for (const group of audiobookGroupEdits) {
      for (const idx of group.fileIndices) {
        audiobookFileIndices.add(idx);
      }
      // Also include cover image
      if (group.coverIndex !== undefined) {
        audiobookFileIndices.add(group.coverIndex);
      }
    }

    const regularFiles = filesToUpload.filter((_, i) => !audiobookFileIndices.has(i));

    // Initialize progress for all files
    const initialProgress = new Map<string, UploadFileProgress>();
    for (const item of filesToUpload) {
      const key = item.relativePath ?? item.file.name;
      initialProgress.set(key, { progress: 0, status: 'uploading' });
    }
    // Add audiobook group progress entries
    for (const group of audiobookGroupEdits) {
      const title = group.editedTitle ?? group.title;
      initialProgress.set(`audiobook:${title}`, { progress: 0, status: 'uploading' });
    }
    setUploadProgress(new Map(initialProgress));

    // Upload audiobook groups via the dedicated endpoint
    const audiobookUploads = audiobookGroupEdits.map(async (group) => {
      const title = group.editedTitle ?? group.title;
      const author = group.editedAuthor ?? group.author;
      const series = group.editedSeries ?? group.series;
      const progressKey = `audiobook:${title}`;

      // Collect files for this group
      const groupFiles: File[] = [];
      for (const idx of group.fileIndices) {
        const dropped = droppedFiles[idx];
        if (dropped) groupFiles.push(dropped.file);
      }
      // Include cover if present
      if (group.coverIndex !== undefined) {
        const coverDropped = droppedFiles[group.coverIndex];
        if (coverDropped && !group.fileIndices.includes(group.coverIndex)) {
          groupFiles.push(coverDropped.file);
        }
      }

      try {
        await uploadAudiobook({
          title,
          author: author ?? undefined,
          series: series ?? undefined,
          files: groupFiles,
          onProgress: (percent) => {
            setUploadProgress((prev) => {
              const next = new Map(prev);
              next.set(progressKey, { progress: percent, status: 'uploading' });
              // Also update individual file progress
              for (const idx of group.fileIndices) {
                const dropped = droppedFiles[idx];
                if (dropped) {
                  const key = dropped.relativePath ?? dropped.file.name;
                  next.set(key, { progress: percent, status: 'uploading' });
                }
              }
              return next;
            });
          },
        });

        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(progressKey, { progress: 100, status: 'done' });
          for (const idx of group.fileIndices) {
            const dropped = droppedFiles[idx];
            if (dropped) {
              const key = dropped.relativePath ?? dropped.file.name;
              next.set(key, { progress: 100, status: 'done' });
            }
          }
          return next;
        });
      } catch {
        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(progressKey, { progress: 0, status: 'error' });
          for (const idx of group.fileIndices) {
            const dropped = droppedFiles[idx];
            if (dropped) {
              const key = dropped.relativePath ?? dropped.file.name;
              next.set(key, { progress: 0, status: 'error' });
            }
          }
          return next;
        });
      }
    });

    // Upload regular (non-audiobook) files concurrently
    const queue = [...regularFiles];
    const active: Promise<void>[] = [];

    const uploadNext = async (): Promise<void> => {
      const item = queue.shift();
      if (!item) return;

      const key = item.relativePath ?? item.file.name;

      try {
        await uploadFile(
          item.file,
          item.service,
          (percent) => {
            setUploadProgress((prev) => {
              const next = new Map(prev);
              next.set(key, { progress: percent, status: 'uploading' });
              return next;
            });
          },
          item.relativePath,
        );

        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(key, { progress: 100, status: 'done' });
          return next;
        });
      } catch {
        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(key, {
            progress: prev.get(key)?.progress ?? 0,
            status: 'error',
          });
          return next;
        });
      }

      await uploadNext();
    };

    for (let i = 0; i < MAX_CONCURRENT; i++) {
      active.push(uploadNext());
    }

    // Run audiobook uploads and regular uploads in parallel
    await Promise.all([...audiobookUploads, ...active]);

    const affectedServices = new Set(filesToUpload.map((f) => f.service));
    for (const service of affectedServices) {
      for (const queryKey of SERVICE_QUERY_KEYS[service]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  }, [classifiedFiles, audiobookGroupEdits, droppedFiles, queryClient]);

  const handleReset = useCallback(() => {
    setStep('select');
    setDroppedFiles([]);
    setUploadProgress(new Map());
    setAudiobookGroupEdits([]);
    probedRef.current = false;
    streaming.reset();
  }, [streaming]);

  return (
    <div style={{ minHeight: 'calc(100vh - 120px)' }}>
      <div style={{ padding: '16px 16px 0' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Upload
        </Typography.Title>
      </div>

      <DropZone
        files={classifiedFiles}
        step={step === 'streaming' ? 'streaming' : step === 'upload' ? 'upload' : 'select'}
        uploadProgress={uploadProgress}
        audiobookGroups={audiobookGroupEdits.length > 0 ? audiobookGroupEdits : streaming.audiobookGroups}
        onFilesSelected={(dropped) => { handleFilesSelected(dropped); }}
        onOverride={handleOverride}
        onConfirm={() => void handleConfirm()}
        onReset={handleReset}
        onAudiobookGroupChange={handleAudiobookGroupChange}
        isProbing={isProbing}
        // Streaming props
        droppedFiles={droppedFiles}
        streamedClassifications={streaming.classifications}
        streamingPhase={streaming.phase}
        pendingCount={streaming.pendingCount}
      />
    </div>
  );
}
