import { useCallback, useMemo } from 'react';
import { Table, Button, Popconfirm, Dropdown, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  File,
  FileImage,
  FileVideo,
  FileDoc,
  FileZip,
  DownloadSimple,
  Trash,
} from '@phosphor-icons/react';
import { SERVICE_LABELS, SERVICES, formatFileSize } from '@steadfirm/shared';
import type { UserFile } from '@steadfirm/shared';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export interface FileTableProps {
  files: UserFile[];
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  onReclassify: (id: string, service: string) => void;
  loading?: boolean;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <FileImage size={20} weight="duotone" />;
  if (mimeType.startsWith('video/')) return <FileVideo size={20} weight="duotone" />;
  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('pdf') ||
    mimeType.includes('document') ||
    mimeType.includes('msword')
  ) {
    return <FileDoc size={20} weight="duotone" />;
  }
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compress')) {
    return <FileZip size={20} weight="duotone" />;
  }
  return <File size={20} weight="duotone" />;
}

function getHumanReadableType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType.startsWith('video/')) return 'Video';
  if (mimeType.startsWith('audio/')) return 'Audio';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('zip')) return 'Archive';
  if (mimeType.includes('document') || mimeType.includes('msword')) return 'Document';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'Spreadsheet';
  if (mimeType.startsWith('text/')) return 'Text';
  return 'File';
}

const reclassifyServices = SERVICES.filter((s) => s !== 'files');

export function FileTable({
  files,
  onDownload,
  onDelete,
  onReclassify,
  loading,
}: FileTableProps) {
  const handleDownload = useCallback(
    (id: string) => {
      onDownload(id);
    },
    [onDownload],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  const columns: ColumnsType<UserFile> = useMemo(
    () => [
      {
        title: '',
        dataIndex: 'mimeType',
        key: 'icon',
        width: 48,
        render: (mimeType: string) => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {getFileIcon(mimeType)}
          </div>
        ),
      },
      {
        title: 'Filename',
        dataIndex: 'filename',
        key: 'filename',
        ellipsis: true,
        render: (filename: string) => (
          <span style={{ fontWeight: 500 }}>{filename}</span>
        ),
      },
      {
        title: 'Type',
        dataIndex: 'mimeType',
        key: 'type',
        width: 120,
        responsive: ['md'],
        render: (mimeType: string) => (
          <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13 }}>
            {getHumanReadableType(mimeType)}
          </span>
        ),
      },
      {
        title: 'Size',
        dataIndex: 'sizeBytes',
        key: 'size',
        width: 100,
        responsive: ['sm'],
        render: (sizeBytes: number) => (
          <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13 }}>
            {formatFileSize(sizeBytes)}
          </span>
        ),
      },
      {
        title: 'Date',
        dataIndex: 'createdAt',
        key: 'date',
        width: 140,
        responsive: ['md'],
        render: (createdAt: string) => (
          <Tooltip title={dayjs(createdAt).format('YYYY-MM-DD HH:mm')}>
            <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13 }}>
              {dayjs(createdAt).fromNow()}
            </span>
          </Tooltip>
        ),
      },
      {
        title: '',
        key: 'actions',
        width: 140,
        render: (_: unknown, record: UserFile) => (
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            <Tooltip title="Download">
              <Button
                type="text"
                size="small"
                icon={<DownloadSimple size={16} />}
                onClick={() => handleDownload(record.id)}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: reclassifyServices.map((service) => ({
                  key: service,
                  label: SERVICE_LABELS[service],
                  onClick: () => onReclassify(record.id, service),
                })),
              }}
              trigger={['click']}
            >
              <Button type="text" size="small">
                Move to...
              </Button>
            </Dropdown>
            <Popconfirm
              title="Delete this file?"
              description="This action cannot be undone."
              onConfirm={() => handleDelete(record.id)}
              okText="Delete"
              cancelText="Cancel"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Delete">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<Trash size={16} />}
                />
              </Tooltip>
            </Popconfirm>
          </div>
        ),
      },
    ],
    [handleDownload, handleDelete, onReclassify],
  );

  return (
    <Table<UserFile>
      columns={columns}
      dataSource={files}
      rowKey="id"
      loading={loading}
      pagination={false}
      size="middle"
      style={{ width: '100%' }}
    />
  );
}
