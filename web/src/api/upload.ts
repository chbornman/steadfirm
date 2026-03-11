import type { UploadResponse, UploadConfirmRequest, ServiceName } from '@steadfirm/shared';
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
