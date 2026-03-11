import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Typography } from 'antd';
import { DropZone } from '@steadfirm/ui';
import type { ClassifiedFile, UploadFileProgress, DroppedFile } from '@steadfirm/ui';
import { classifyFile } from '@steadfirm/shared';
import type { ServiceName, AudiobookGroup } from '@steadfirm/shared';
import { uploadFile } from '@/api/upload';
import { classifyFiles } from '@/api/classify';
import { log } from '@/lib/logger';
import { useDebugStore } from '@/stores/debug';

/** Map service names to the query key prefixes used by each tab's queries. */
const SERVICE_QUERY_KEYS: Record<ServiceName, string[][]> = {
  photos: [['photos']],
  media: [['media']],
  documents: [['documents']],
  audiobooks: [['audiobooks']],
  files: [['files']],
};

type Step = 'select' | 'analyzing' | 'review' | 'upload';

const MAX_CONCURRENT = 3;

/** Confidence threshold below which the LLM is consulted. */
const AI_CONFIDENCE_THRESHOLD = 0.85;

export function UploadPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('select');
  const [files, setFiles] = useState<ClassifiedFile[]>([]);
  const [audiobookGroups, setAudiobookGroups] = useState<AudiobookGroup[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Map<string, UploadFileProgress>>(new Map());

  const handleFilesSelected = useCallback(async (droppedFiles: DroppedFile[]) => {
    if (droppedFiles.length === 0) return;

    // ── Phase 1: Instant heuristic classification ──
    const classified: ClassifiedFile[] = droppedFiles.map(({ file, relativePath }) => {
      const result = classifyFile(file.name, file.type, file.size, relativePath);
      return {
        file,
        service: result.service,
        confidence: result.confidence,
        relativePath,
      };
    });

    setFiles(classified);
    setStep('analyzing');

    // ── Phase 2: Call backend /classify for low-confidence files ──
    const lowConfidenceIndices = classified
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.confidence < AI_CONFIDENCE_THRESHOLD)
      .map(({ i }) => i);

    if (lowConfidenceIndices.length > 0) {
      const { addRequest, addResponse } = useDebugStore.getState();
      let debugPairId: string | undefined;

      try {
        const fileEntries = lowConfidenceIndices.map((i) => {
          const f = classified[i];
          if (!f) throw new Error(`Missing classified file at index ${i}`);
          return {
            filename: f.file.name,
            mimeType: f.file.type,
            sizeBytes: f.file.size,
            relativePath: f.relativePath,
          };
        });

        log.info('classify request', {
          total: classified.length,
          lowConfidence: lowConfidenceIndices.length,
        });

        // Log request to debug store
        debugPairId = addRequest(
          JSON.stringify({ files: fileEntries }, null, 2),
          `POST /classify (${fileEntries.length} files)`,
        );

        const response = await classifyFiles(fileEntries);

        // Log response to debug store
        addResponse(
          debugPairId,
          'response',
          JSON.stringify(response, null, 2),
          `${response.files.length} results`,
          response.debugInfo,
        );

        // Merge AI results back into the classified array
        const updated = [...classified];
        for (const result of response.files) {
          // result.index is relative to the lowConfidenceIndices batch
          const globalIndex = lowConfidenceIndices[result.index];
          if (globalIndex === undefined) continue;
          const existing = updated[globalIndex];
          if (existing) {
            updated[globalIndex] = {
              ...existing,
              service: result.service,
              confidence: result.confidence,
              reasoning: result.reasoning,
              aiClassified: result.aiClassified,
            };
          }
        }

        setFiles(updated);
        setAudiobookGroups(response.audiobookGroups);
      } catch (err) {
        // Log error to debug store
        if (debugPairId) {
          addResponse(
            debugPairId,
            'error',
            err instanceof Error ? err.message : String(err),
          );
        }
        log.warn('classify endpoint failed, using heuristics only', { err });
      }
    }

    setStep('review');
  }, []);

  const handleOverride = useCallback((index: number, service: ServiceName) => {
    setFiles((prev) => {
      const next = [...prev];
      const item = next[index];
      if (item) {
        next[index] = { ...item, service, confidence: 1.0, reasoning: undefined, aiClassified: false };
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    setStep('upload');

    const initialProgress = new Map<string, UploadFileProgress>();
    for (const item of files) {
      const key = item.relativePath ?? item.file.name;
      initialProgress.set(key, { progress: 0, status: 'uploading' });
    }
    setUploadProgress(new Map(initialProgress));

    // Upload files concurrently with a limit
    const queue = [...files];
    const active: Promise<void>[] = [];

    const uploadNext = async (): Promise<void> => {
      const item = queue.shift();
      if (!item) return;

      const key = item.relativePath ?? item.file.name;

      try {
        await uploadFile(item.file, item.service, (percent) => {
          setUploadProgress((prev) => {
            const next = new Map(prev);
            next.set(key, { progress: percent, status: 'uploading' });
            return next;
          });
        }, item.relativePath);

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

    await Promise.all(active);

    // Invalidate caches for all services that received uploads so the
    // destination tabs show the new items without a manual page refresh.
    const affectedServices = new Set(files.map((f) => f.service));
    for (const service of affectedServices) {
      for (const queryKey of SERVICE_QUERY_KEYS[service]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  }, [files, queryClient]);

  const handleReset = useCallback(() => {
    setStep('select');
    setFiles([]);
    setAudiobookGroups([]);
    setUploadProgress(new Map());
  }, []);

  return (
    <div style={{ minHeight: 'calc(100vh - 120px)' }}>
      <div style={{ padding: '16px 16px 0' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Upload
        </Typography.Title>
      </div>

      <DropZone
        files={files}
        step={step}
        uploadProgress={uploadProgress}
        audiobookGroups={audiobookGroups}
        onFilesSelected={(dropped) => void handleFilesSelected(dropped)}
        onOverride={handleOverride}
        onConfirm={() => void handleConfirm()}
        onReset={handleReset}
      />
    </div>
  );
}
