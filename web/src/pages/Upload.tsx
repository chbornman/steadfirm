import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Typography } from 'antd';
import { DropZone } from '@steadfirm/ui';
import type { ClassifiedFile, UploadFileProgress } from '@steadfirm/ui';
import { classifyFile } from '@steadfirm/shared';
import type { ServiceName } from '@steadfirm/shared';
import { uploadFile } from '@/api/upload';

/** Map service names to the query key prefixes used by each tab's queries. */
const SERVICE_QUERY_KEYS: Record<ServiceName, string[][]> = {
  photos: [['photos']],
  media: [['media']],
  documents: [['documents']],
  audiobooks: [['audiobooks']],
  files: [['files']],
};

type Step = 'select' | 'review' | 'upload';

const MAX_CONCURRENT = 3;

export function UploadPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('select');
  const [files, setFiles] = useState<ClassifiedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Map<string, UploadFileProgress>>(new Map());

  const handleFilesSelected = useCallback((selectedFiles: File[]) => {
    const classified: ClassifiedFile[] = selectedFiles.map((file) => {
      const result = classifyFile(file.name, file.type, file.size);
      return {
        file,
        service: result.service,
        confidence: result.confidence,
      };
    });

    setFiles(classified);
    setStep('review');
  }, []);

  const handleOverride = useCallback((index: number, service: ServiceName) => {
    setFiles((prev) => {
      const next = [...prev];
      const item = next[index];
      if (item) {
        next[index] = { ...item, service, confidence: 1.0 };
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    setStep('upload');

    const initialProgress = new Map<string, UploadFileProgress>();
    for (const item of files) {
      initialProgress.set(item.file.name, { progress: 0, status: 'uploading' });
    }
    setUploadProgress(new Map(initialProgress));

    // Upload files concurrently with a limit
    const queue = [...files];
    const active: Promise<void>[] = [];

    const uploadNext = async (): Promise<void> => {
      const item = queue.shift();
      if (!item) return;

      try {
        await uploadFile(item.file, item.service, (percent) => {
          setUploadProgress((prev) => {
            const next = new Map(prev);
            next.set(item.file.name, { progress: percent, status: 'uploading' });
            return next;
          });
        });

        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(item.file.name, { progress: 100, status: 'done' });
          return next;
        });
      } catch {
        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(item.file.name, {
            progress: prev.get(item.file.name)?.progress ?? 0,
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
        onFilesSelected={handleFilesSelected}
        onOverride={handleOverride}
        onConfirm={() => void handleConfirm()}
        onReset={handleReset}
      />
    </div>
  );
}
