import { Upload, Button, Select, Progress, Tag, Typography } from 'antd';
import { CloudArrowUp, Check, X } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { SERVICE_LABELS, SERVICE_COLORS, SERVICES, formatFileSize } from '@steadfirm/shared';
import type { ServiceName } from '@steadfirm/shared';
import { colors } from '@steadfirm/theme';

export interface ClassifiedFile {
  file: File;
  service: ServiceName;
  confidence: number;
}

export interface UploadFileProgress {
  progress: number;
  status: 'uploading' | 'done' | 'error';
}

export interface DropZoneProps {
  files: ClassifiedFile[];
  step: 'select' | 'review' | 'upload';
  uploadProgress: Map<string, UploadFileProgress>;
  onFilesSelected: (files: File[]) => void;
  onOverride: (index: number, service: ServiceName) => void;
  onConfirm: () => void;
  onReset: () => void;
}

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

function SelectStep({ onFilesSelected }: { onFilesSelected: (files: File[]) => void }) {
  return (
    <motion.div
      key="select"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ maxWidth: 600, margin: '0 auto', padding: '48px 16px' }}
    >
      <Upload.Dragger
        multiple
        showUploadList={false}
        beforeUpload={(_file, fileList) => {
          onFilesSelected(fileList);
          return false;
        }}
        style={{
          padding: '48px 24px',
          borderColor: colors.accent,
          borderStyle: 'dashed',
          borderWidth: 2,
          borderRadius: 12,
          background: colors.accentSubtle,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <CloudArrowUp size={56} weight="duotone" color={colors.accent} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            Drop files here or click to browse
          </Typography.Title>
          <Typography.Text type="secondary">
            Files will be automatically classified and routed to the right service
          </Typography.Text>
        </div>
      </Upload.Dragger>
    </motion.div>
  );
}

function ReviewStep({
  files,
  onOverride,
  onConfirm,
  onReset,
}: {
  files: ClassifiedFile[];
  onOverride: (index: number, service: ServiceName) => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {files.map((item, index) => (
          <div
            key={`${item.file.name}-${index}`}
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
                }}
              >
                {item.file.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginTop: 2 }}>
                {formatFileSize(item.file.size)}
              </div>
            </div>

            <Tag
              color={SERVICE_COLORS[item.service]}
              style={{ margin: 0, fontSize: 12 }}
            >
              {SERVICE_LABELS[item.service]}
            </Tag>

            <div
              style={{
                fontSize: 11,
                color: 'var(--ant-color-text-tertiary)',
                minWidth: 40,
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
              style={{ width: 140 }}
              popupMatchSelectWidth={false}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onReset}>Cancel</Button>
        <Button
          type="primary"
          onClick={onConfirm}
          style={{ background: colors.accent, borderColor: colors.accent }}
        >
          Upload All
        </Button>
      </div>
    </motion.div>
  );
}

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
    const progress = uploadProgress.get(f.file.name);
    return progress && (progress.status === 'done' || progress.status === 'error');
  });

  const doneCount = files.filter((f) => uploadProgress.get(f.file.name)?.status === 'done').length;
  const errorCount = files.filter((f) => uploadProgress.get(f.file.name)?.status === 'error').length;

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
          const progress = uploadProgress.get(item.file.name);
          const status = progress?.status ?? 'uploading';
          const percent = progress?.progress ?? 0;

          return (
            <div
              key={`${item.file.name}-${index}`}
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
                  {item.file.name}
                </div>
                <Progress
                  percent={percent}
                  size="small"
                  showInfo={false}
                  status={status === 'error' ? 'exception' : status === 'done' ? 'success' : 'active'}
                  strokeColor={status === 'uploading' ? colors.accent : undefined}
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
            style={{ background: colors.accent, borderColor: colors.accent }}
          >
            Upload More
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export function DropZone({
  files,
  step,
  uploadProgress,
  onFilesSelected,
  onOverride,
  onConfirm,
  onReset,
}: DropZoneProps) {
  return (
    <AnimatePresence mode="wait">
      {step === 'select' && <SelectStep onFilesSelected={onFilesSelected} />}
      {step === 'review' && (
        <ReviewStep
          files={files}
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
