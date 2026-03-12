import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Typography } from 'antd';
import { DropZone } from '@steadfirm/ui';
import type { ClassifiedFile, UploadFileProgress, DroppedFile } from '@steadfirm/ui';
import type { ServiceName } from '@steadfirm/shared';
import { uploadFile } from '@/api/upload';
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

  const streaming = useStreamingClassify();

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

  const handleConfirm = useCallback(async () => {
    setStep('upload');

    const filesToUpload = classifiedFiles;

    const initialProgress = new Map<string, UploadFileProgress>();
    for (const item of filesToUpload) {
      const key = item.relativePath ?? item.file.name;
      initialProgress.set(key, { progress: 0, status: 'uploading' });
    }
    setUploadProgress(new Map(initialProgress));

    const queue = [...filesToUpload];
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

    await Promise.all(active);

    const affectedServices = new Set(filesToUpload.map((f) => f.service));
    for (const service of affectedServices) {
      for (const queryKey of SERVICE_QUERY_KEYS[service]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  }, [classifiedFiles, queryClient]);

  const handleReset = useCallback(() => {
    setStep('select');
    setDroppedFiles([]);
    setUploadProgress(new Map());
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
        audiobookGroups={streaming.audiobookGroups}
        onFilesSelected={(dropped) => { handleFilesSelected(dropped); }}
        onOverride={handleOverride}
        onConfirm={() => void handleConfirm()}
        onReset={handleReset}
        // Streaming props
        droppedFiles={droppedFiles}
        streamedClassifications={streaming.classifications}
        streamingPhase={streaming.phase}
        pendingCount={streaming.pendingCount}
      />
    </div>
  );
}
