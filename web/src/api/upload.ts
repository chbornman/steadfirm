import type { UploadResponse, UploadConfirmRequest, ServiceName, AudioFileProbe } from '@steadfirm/shared';
import { api } from './client';
import { log } from '@/lib/logger';

interface UploadFileResult {
  status: string;
  service: string;
  filename: string;
}

export async function uploadFile(
  file: File,
  service: ServiceName,
  onProgress?: (percent: number) => void,
  relativePath?: string,
): Promise<UploadFileResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('service', service);
  formData.append('filename', file.name);
  if (relativePath) {
    formData.append('relative_path', relativePath);
  }

  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  log.info('upload starting', { filename: file.name, service, sizeMB, type: file.type, relativePath });

  // Use XMLHttpRequest for progress tracking
  return new Promise<UploadFileResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/upload');
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const result = JSON.parse(xhr.responseText) as UploadFileResult;
        log.info('upload complete', { filename: file.name, service, status: xhr.status });
        resolve(result);
      } else {
        const body = xhr.responseText.slice(0, 500);
        log.error('upload failed', { filename: file.name, service, status: xhr.status, body });
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText} — ${body}`));
      }
    });

    xhr.addEventListener('error', () => {
      log.error('upload network error', { filename: file.name, service });
      reject(new Error('Upload failed: network error'));
    });

    xhr.addEventListener('abort', () => {
      log.warn('upload aborted', { filename: file.name, service });
      reject(new Error('Upload aborted'));
    });

    xhr.send(formData);
  });
}

export interface AudiobookUploadParams {
  title: string;
  author?: string;
  series?: string;
  files: File[];
  onProgress?: (percent: number) => void;
}

interface AudiobookUploadResult {
  status: string;
  service: string;
  title: string;
  fileCount: number;
}

/** Upload a complete audiobook (all files for one book) via the dedicated ABS upload endpoint. */
export function uploadAudiobook({
  title,
  author,
  series,
  files,
  onProgress,
}: AudiobookUploadParams): Promise<AudiobookUploadResult> {
  const formData = new FormData();
  formData.append('title', title);
  if (author) formData.append('author', author);
  if (series) formData.append('series', series);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file) formData.append(String(i), file);
  }

  const totalMB = (files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1);
  log.info('audiobook upload starting', { title, author, series, fileCount: files.length, totalMB });

  return new Promise<AudiobookUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/upload/audiobook');
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const result = JSON.parse(xhr.responseText) as AudiobookUploadResult;
        log.info('audiobook upload complete', { title, status: xhr.status });
        resolve(result);
      } else {
        const body = xhr.responseText.slice(0, 500);
        log.error('audiobook upload failed', { title, status: xhr.status, body });
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText} — ${body}`));
      }
    });

    xhr.addEventListener('error', () => {
      log.error('audiobook upload network error', { title });
      reject(new Error('Upload failed: network error'));
    });

    xhr.send(formData);
  });
}

/** Probe audio files via ffprobe to extract ID3 tags and duration. */
export async function probeAudioFiles(
  files: Array<{ index: number; file: File }>,
): Promise<AudioFileProbe[]> {
  const formData = new FormData();
  for (const { index, file } of files) {
    formData.append(String(index), file);
  }

  log.info('probing audio files', { count: files.length });

  const resp = await fetch('/api/v1/classify/probe', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!resp.ok) {
    throw new Error(`Probe failed: ${resp.status}`);
  }

  return resp.json() as Promise<AudioFileProbe[]>;
}

export async function uploadBatch(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post('api/v1/upload/batch', { body: formData }).json<UploadResponse>();
}

export async function confirmUpload(request: UploadConfirmRequest): Promise<void> {
  await api.post('api/v1/upload/confirm', { json: request });
}
