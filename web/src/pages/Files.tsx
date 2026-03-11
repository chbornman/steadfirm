import { useState, useEffect, useMemo, useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Select, Typography, Spin, message } from 'antd';
import { Folder } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileTable } from '@steadfirm/ui';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import type { FileListResponse } from '@steadfirm/shared';
import { api } from '@/api/client';
import { deleteFile, reclassifyFile } from '@/api/files';
import { useIntersection } from '@/hooks/useIntersection';

type SortOption = 'createdAt:desc' | 'filename:asc' | 'sizeBytes:desc' | 'mimeType:asc';

export function FilesPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [sort, setSort] = useState<SortOption>('createdAt:desc');

  const [sortField, sortOrder] = sort.split(':') as [string, string];

  const { ref: sentinelRef, isIntersecting } = useIntersection({
    rootMargin: '200% 0px',
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['files', 'list', { sort: sortField, order: sortOrder }],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/files', {
          searchParams: {
            page: pageParam,
            pageSize: DEFAULT_PAGE_SIZE,
            sort: sortField,
            order: sortOrder,
          },
        })
        .json<FileListResponse>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
  });

  const allFiles = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const totalCount = data?.pages[0]?.total ?? 0;

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

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

      {/* Sort bar */}
      <div
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          background: 'var(--ant-color-bg-layout)',
          borderBottom: '1px solid var(--ant-color-border)',
        }}
      >
        <Select
          value={sort}
          onChange={setSort}
          size="small"
          style={{ width: 160 }}
          options={[
            { value: 'createdAt:desc', label: 'Recently added' },
            { value: 'filename:asc', label: 'Name A-Z' },
            { value: 'sizeBytes:desc', label: 'Largest first' },
            { value: 'mimeType:asc', label: 'Type' },
          ]}
        />
        <div style={{ flex: 1 }} />
        {totalCount > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {totalCount.toLocaleString()} {totalCount === 1 ? 'file' : 'files'}
          </Typography.Text>
        )}
      </div>

      {/* File table */}
      <div style={{ padding: 16, minHeight: 'calc(100vh - 120px)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allFiles.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 'calc(100vh - 250px)',
              color: 'var(--ant-color-text-secondary)',
            }}
          >
            <Folder size={64} weight="duotone" />
            <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
              No files yet
            </Typography.Title>
            <Typography.Text type="secondary">
              Upload your first files to get started
            </Typography.Text>
          </div>
        ) : (
          <FileTable
            files={allFiles}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onReclassify={handleReclassify}
            loading={isLoading}
          />
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} style={{ height: 1 }} />

        <AnimatePresence>
          {isFetchingNextPage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ display: 'flex', justifyContent: 'center', padding: 24 }}
            >
              <Spin />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
