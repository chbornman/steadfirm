import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Spin, message } from 'antd';
import { Folder } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { fadeIn } from '@steadfirm/theme';
import { FileTable } from '@steadfirm/ui';
import { deleteFile, reclassifyFile } from '@/api/files';
import type { UserFile } from '@steadfirm/shared';
import { ContentPage, FilterRail, useContentList } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';

type SortOption = 'createdAt:desc' | 'filename:asc' | 'sizeBytes:desc' | 'mimeType:asc';

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'createdAt:desc', label: 'Recently added' },
  { value: 'filename:asc', label: 'Name A-Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'mimeType:asc', label: 'Type' },
];

export function FilesPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [sort, setSort] = useState<SortOption>('createdAt:desc');

  const [sortField, sortOrder] = sort.split(':') as [string, string];

  const { items: allFiles, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<UserFile>({
      queryKey: ['files', 'list', { sort: sortField, order: sortOrder }],
      endpoint: 'api/v1/files',
      params: { sort: sortField, order: sortOrder },
    });

  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      void messageApi.success('File deleted');
    },
    onError: () => {
      void messageApi.error('Failed to delete file');
    },
  });

  const reclassifyMutation = useMutation({
    mutationFn: ({ id, service }: { id: string; service: string }) =>
      reclassifyFile(id, service),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      void messageApi.success(`File moved to ${variables.service}`);
    },
    onError: () => {
      void messageApi.error('Failed to reclassify file');
    },
  });

  const handleDownload = useCallback((id: string) => {
    const file = allFiles.find((f) => f.id === id);
    if (file) {
      window.open(file.downloadUrl, '_blank');
    }
  }, [allFiles]);

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const handleReclassify = useCallback(
    (id: string, service: string) => {
      reclassifyMutation.mutate({ id, service });
    },
    [reclassifyMutation],
  );

  return (
    <>
      {contextHolder}

      <ContentPage
        sentinelRef={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        filterRail={
          <FilterRail>
            <FilterRail.Sort value={sort} onChange={setSort} options={sortOptions} />
          </FilterRail>
        }
      >
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allFiles.length === 0 ? (
          <EmptyState
            icon={<Folder size={64} weight="duotone" />}
            title="No files yet"
            description="Upload your first files to get started"
          />
        ) : (
          <motion.div
            variants={fadeIn}
            initial="hidden"
            animate="visible"
            style={{ paddingTop: 16 }}
          >
            <FileTable
              files={allFiles}
              onDownload={handleDownload}
              onDelete={handleDelete}
              onReclassify={handleReclassify}
              loading={isLoading}
            />
          </motion.div>
        )}
      </ContentPage>
    </>
  );
}
