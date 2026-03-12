import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Typography } from 'antd';
import { DropZone } from '@steadfirm/ui';
import type {
  ClassifiedFile,
  UploadFileProgress,
  DroppedFile,
  AudiobookGroupEditable,
  TvShowGroupEditable,
  MovieGroupEditable,
  MusicAlbumGroupEditable,
  ReadingGroupEditable,
} from '@steadfirm/ui';
import type { ServiceName } from '@steadfirm/shared';
import { uploadFile, uploadAudiobook, uploadMedia, uploadReading, probeAudioFiles } from '@/api/upload';
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
  const [tvShowGroupEdits, setTvShowGroupEdits] = useState<TvShowGroupEditable[]>([]);
  const [movieGroupEdits, setMovieGroupEdits] = useState<MovieGroupEditable[]>([]);
  const [musicGroupEdits, setMusicGroupEdits] = useState<MusicAlbumGroupEditable[]>([]);
  const [readingGroupEdits, setReadingGroupEdits] = useState<ReadingGroupEditable[]>([]);
  const [isProbing, setIsProbing] = useState(false);
  const probedRef = useRef(false);

  const streaming = useStreamingClassify();

  // Sync all groups from streaming into editable state when done
  useEffect(() => {
    if (streaming.phase !== 'done') return;

    // Audiobooks
    if (streaming.audiobookGroups.length > 0) {
      setAudiobookGroupEdits((prev) => {
        if (prev.length === 0) return streaming.audiobookGroups.map((g) => ({ ...g }));
        return prev;
      });
    }

    // TV Shows
    if (streaming.tvShowGroups.length > 0) {
      setTvShowGroupEdits((prev) => {
        if (prev.length === 0) return streaming.tvShowGroups.map((g) => ({ ...g }));
        return prev;
      });
    }

    // Movies
    if (streaming.movieGroups.length > 0) {
      setMovieGroupEdits((prev) => {
        if (prev.length === 0) return streaming.movieGroups.map((g) => ({ ...g }));
        return prev;
      });
    }

    // Music
    if (streaming.musicGroups.length > 0) {
      setMusicGroupEdits((prev) => {
        if (prev.length === 0) return streaming.musicGroups.map((g) => ({ ...g }));
        return prev;
      });
    }

    // Reading
    if (streaming.readingGroups.length > 0) {
      setReadingGroupEdits((prev) => {
        if (prev.length === 0) return streaming.readingGroups.map((g) => ({ ...g }));
        return prev;
      });
    }
  }, [
    streaming.phase,
    streaming.audiobookGroups,
    streaming.tvShowGroups,
    streaming.movieGroups,
    streaming.musicGroups,
    streaming.readingGroups,
  ]);

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
      setTvShowGroupEdits([]);
      setMovieGroupEdits([]);
      setMusicGroupEdits([]);
      setReadingGroupEdits([]);

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

  // ─── Group change handlers ─────────────────────────────────────────

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

  const handleTvShowGroupChange = useCallback(
    (groupIndex: number, updates: Partial<TvShowGroupEditable>) => {
      setTvShowGroupEdits((prev) => {
        const next = [...prev];
        if (next[groupIndex]) {
          next[groupIndex] = { ...next[groupIndex], ...updates };
        }
        return next;
      });
    },
    [],
  );

  const handleMovieGroupChange = useCallback(
    (groupIndex: number, updates: Partial<MovieGroupEditable>) => {
      setMovieGroupEdits((prev) => {
        const next = [...prev];
        if (next[groupIndex]) {
          next[groupIndex] = { ...next[groupIndex], ...updates };
        }
        return next;
      });
    },
    [],
  );

  const handleMusicGroupChange = useCallback(
    (groupIndex: number, updates: Partial<MusicAlbumGroupEditable>) => {
      setMusicGroupEdits((prev) => {
        const next = [...prev];
        if (next[groupIndex]) {
          next[groupIndex] = { ...next[groupIndex], ...updates };
        }
        return next;
      });
    },
    [],
  );

  const handleReadingGroupChange = useCallback(
    (groupIndex: number, updates: Partial<ReadingGroupEditable>) => {
      setReadingGroupEdits((prev) => {
        const next = [...prev];
        if (next[groupIndex]) {
          next[groupIndex] = { ...next[groupIndex], ...updates };
        }
        return next;
      });
    },
    [],
  );

  // ─── Upload logic ──────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    setStep('upload');

    const filesToUpload = classifiedFiles;

    // Collect all file indices that belong to structured groups
    const groupedFileIndices = new Set<number>();

    // Audiobook indices
    for (const group of audiobookGroupEdits) {
      for (const idx of group.fileIndices) groupedFileIndices.add(idx);
      if (group.coverIndex !== undefined) groupedFileIndices.add(group.coverIndex);
    }

    // TV Show indices
    for (const group of tvShowGroupEdits) {
      for (const idx of group.fileIndices) groupedFileIndices.add(idx);
    }

    // Movie indices
    for (const group of movieGroupEdits) {
      groupedFileIndices.add(group.fileIndex);
      for (const idx of group.subtitleIndices ?? []) groupedFileIndices.add(idx);
      for (const idx of group.extraIndices ?? []) groupedFileIndices.add(idx);
    }

    // Music indices
    for (const group of musicGroupEdits) {
      for (const idx of group.fileIndices) groupedFileIndices.add(idx);
      if (group.coverIndex !== undefined) groupedFileIndices.add(group.coverIndex);
    }

    // Reading indices
    for (const group of readingGroupEdits) {
      for (const idx of group.fileIndices) groupedFileIndices.add(idx);
    }

    const regularFiles = filesToUpload.filter((_, i) => !groupedFileIndices.has(i));

    // Initialize progress for all files
    const initialProgress = new Map<string, UploadFileProgress>();
    for (const item of filesToUpload) {
      const key = item.relativePath ?? item.file.name;
      initialProgress.set(key, { progress: 0, status: 'uploading' });
    }
    // Group progress keys
    for (const group of audiobookGroupEdits) {
      initialProgress.set(`audiobook:${group.editedTitle ?? group.title}`, { progress: 0, status: 'uploading' });
    }
    for (const group of tvShowGroupEdits) {
      initialProgress.set(`tvshow:${group.editedSeriesName ?? group.seriesName}`, { progress: 0, status: 'uploading' });
    }
    for (const group of movieGroupEdits) {
      initialProgress.set(`movie:${group.editedTitle ?? group.title}`, { progress: 0, status: 'uploading' });
    }
    for (const group of musicGroupEdits) {
      initialProgress.set(`music:${group.editedAlbum ?? group.album}`, { progress: 0, status: 'uploading' });
    }
    for (const group of readingGroupEdits) {
      initialProgress.set(`reading:${group.editedSeriesName ?? group.seriesName}`, { progress: 0, status: 'uploading' });
    }
    setUploadProgress(new Map(initialProgress));

    // Helper to update grouped file progress
    const updateGroupProgress = (
      progressKey: string,
      indices: number[],
      percent: number,
      status: 'uploading' | 'done' | 'error',
    ) => {
      setUploadProgress((prev) => {
        const next = new Map(prev);
        next.set(progressKey, { progress: percent, status });
        for (const idx of indices) {
          const dropped = droppedFiles[idx];
          if (dropped) {
            const key = dropped.relativePath ?? dropped.file.name;
            next.set(key, { progress: percent, status });
          }
        }
        return next;
      });
    };

    const groupedUploads: Promise<void>[] = [];

    // ── Audiobook uploads ──
    for (const group of audiobookGroupEdits) {
      groupedUploads.push((async () => {
        const title = group.editedTitle ?? group.title;
        const author = group.editedAuthor ?? group.author;
        const series = group.editedSeries ?? group.series;
        const progressKey = `audiobook:${title}`;
        const allIndices = [...group.fileIndices];
        if (group.coverIndex !== undefined) allIndices.push(group.coverIndex);

        const groupFiles: File[] = [];
        for (const idx of group.fileIndices) {
          const dropped = droppedFiles[idx];
          if (dropped) groupFiles.push(dropped.file);
        }
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
            onProgress: (p) => updateGroupProgress(progressKey, allIndices, p, 'uploading'),
          });
          updateGroupProgress(progressKey, allIndices, 100, 'done');
        } catch {
          updateGroupProgress(progressKey, allIndices, 0, 'error');
        }
      })());
    }

    // ── TV Show uploads ──
    for (const group of tvShowGroupEdits) {
      // Upload all episodes for each season as a batch
      const seriesName = group.editedSeriesName ?? group.seriesName;
      const year = group.editedYear ?? group.year;
      const progressKey = `tvshow:${seriesName}`;

      // Group episodes by season for proper folder structuring
      const seasonMap = new Map<number, number[]>();
      for (const ep of group.episodes) {
        const existing = seasonMap.get(ep.season) ?? [];
        existing.push(ep.fileIndex);
        seasonMap.set(ep.season, existing);
      }

      for (const [season, fileIndices] of seasonMap) {
        groupedUploads.push((async () => {
          const files = fileIndices
            .map((idx) => {
              const dropped = droppedFiles[idx];
              if (!dropped) return null;
              return { file: dropped.file, path: dropped.file.name };
            })
            .filter((f): f is { file: File; path: string } => f !== null);

          // Also include subtitle files for this season
          const subIndices: number[] = group.subtitleIndices ?? [];
          const subtitleFiles = subIndices
            .map((idx) => {
              const dropped = droppedFiles[idx];
              if (!dropped) return null;
              return { file: dropped.file, path: dropped.file.name };
            })
            .filter((f): f is { file: File; path: string } => f !== null);

          try {
            await uploadMedia({
              mediaType: 'tv_show',
              title: seriesName,
              year,
              season: String(season).padStart(2, '0'),
              files: [...files, ...subtitleFiles],
              onProgress: (p) => updateGroupProgress(progressKey, group.fileIndices, p, 'uploading'),
            });
            updateGroupProgress(progressKey, group.fileIndices, 100, 'done');
          } catch {
            updateGroupProgress(progressKey, group.fileIndices, 0, 'error');
          }
        })());
      }
    }

    // ── Movie uploads ──
    for (const group of movieGroupEdits) {
      groupedUploads.push((async () => {
        const title = group.editedTitle ?? group.title;
        const year = group.editedYear ?? group.year;
        const progressKey = `movie:${title}`;
        const allIndices = [group.fileIndex, ...(group.subtitleIndices ?? []), ...(group.extraIndices ?? [])];

        const files: Array<{ file: File; path: string }> = [];

        // Main video file — rename to match Jellyfin expected naming
        const mainDropped = droppedFiles[group.fileIndex];
        if (mainDropped) {
          const ext = mainDropped.file.name.split('.').pop() ?? '';
          const cleanName = `${title}${year ? ` (${year})` : ''}.${ext}`;
          files.push({ file: mainDropped.file, path: cleanName });
        }

        // Subtitles
        for (const idx of group.subtitleIndices ?? []) {
          const dropped = droppedFiles[idx];
          if (dropped) files.push({ file: dropped.file, path: dropped.file.name });
        }

        // Extras
        for (const idx of group.extraIndices ?? []) {
          const dropped = droppedFiles[idx];
          if (dropped) files.push({ file: dropped.file, path: dropped.file.name });
        }

        try {
          await uploadMedia({
            mediaType: 'movie',
            title,
            year,
            files,
            onProgress: (p) => updateGroupProgress(progressKey, allIndices, p, 'uploading'),
          });
          updateGroupProgress(progressKey, allIndices, 100, 'done');
        } catch {
          updateGroupProgress(progressKey, allIndices, 0, 'error');
        }
      })());
    }

    // ── Music uploads ──
    for (const group of musicGroupEdits) {
      groupedUploads.push((async () => {
        const album = group.editedAlbum ?? group.album;
        const artist = group.editedArtist ?? group.artist;
        const progressKey = `music:${album}`;
        const allIndices = [...group.fileIndices];
        if (group.coverIndex !== undefined) allIndices.push(group.coverIndex);

        const files: Array<{ file: File; path?: string }> = [];
        for (const idx of group.fileIndices) {
          const dropped = droppedFiles[idx];
          if (dropped) files.push({ file: dropped.file });
        }
        if (group.coverIndex !== undefined) {
          const coverDropped = droppedFiles[group.coverIndex];
          if (coverDropped) files.push({ file: coverDropped.file });
        }

        try {
          await uploadMedia({
            mediaType: 'music',
            title: album,
            artist: artist ?? undefined,
            year: group.editedYear ?? group.year,
            files,
            onProgress: (p) => updateGroupProgress(progressKey, allIndices, p, 'uploading'),
          });
          updateGroupProgress(progressKey, allIndices, 100, 'done');
        } catch {
          updateGroupProgress(progressKey, allIndices, 0, 'error');
        }
      })());
    }

    // ── Reading uploads ──
    for (const group of readingGroupEdits) {
      groupedUploads.push((async () => {
        const seriesName = group.editedSeriesName ?? group.seriesName;
        const progressKey = `reading:${seriesName}`;

        const files: File[] = [];
        for (const idx of group.fileIndices) {
          const dropped = droppedFiles[idx];
          if (dropped) files.push(dropped.file);
        }

        try {
          await uploadReading({
            seriesName,
            files,
            onProgress: (p) => updateGroupProgress(progressKey, group.fileIndices, p, 'uploading'),
          });
          updateGroupProgress(progressKey, group.fileIndices, 100, 'done');
        } catch {
          updateGroupProgress(progressKey, group.fileIndices, 0, 'error');
        }
      })());
    }

    // ── Regular (ungrouped) file uploads ──
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

    // Run all uploads in parallel
    await Promise.all([...groupedUploads, ...active]);

    const affectedServices = new Set(filesToUpload.map((f) => f.service));
    for (const service of affectedServices) {
      for (const queryKey of SERVICE_QUERY_KEYS[service]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  }, [
    classifiedFiles,
    audiobookGroupEdits,
    tvShowGroupEdits,
    movieGroupEdits,
    musicGroupEdits,
    readingGroupEdits,
    droppedFiles,
    queryClient,
  ]);

  const handleReset = useCallback(() => {
    setStep('select');
    setDroppedFiles([]);
    setUploadProgress(new Map());
    setAudiobookGroupEdits([]);
    setTvShowGroupEdits([]);
    setMovieGroupEdits([]);
    setMusicGroupEdits([]);
    setReadingGroupEdits([]);
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
        tvShowGroups={tvShowGroupEdits.length > 0 ? tvShowGroupEdits : streaming.tvShowGroups}
        movieGroups={movieGroupEdits.length > 0 ? movieGroupEdits : streaming.movieGroups}
        musicGroups={musicGroupEdits.length > 0 ? musicGroupEdits : streaming.musicGroups}
        readingGroups={readingGroupEdits.length > 0 ? readingGroupEdits : streaming.readingGroups}
        onFilesSelected={(dropped) => { handleFilesSelected(dropped); }}
        onOverride={handleOverride}
        onConfirm={() => void handleConfirm()}
        onReset={handleReset}
        onAudiobookGroupChange={handleAudiobookGroupChange}
        onTvShowGroupChange={handleTvShowGroupChange}
        onMovieGroupChange={handleMovieGroupChange}
        onMusicGroupChange={handleMusicGroupChange}
        onReadingGroupChange={handleReadingGroupChange}
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
