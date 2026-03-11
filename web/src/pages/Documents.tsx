import { useState, useEffect, useMemo, useCallback } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Select, Input, Typography, Spin, Drawer, Tag, Grid } from 'antd';
import { FileText } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { DocumentViewer } from '@steadfirm/ui';
import { gridContainer, gridItem } from '@steadfirm/theme';
import type { DocumentListResponse, Document } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { documentQueries } from '@/api/documents';
import { useIntersection } from '@/hooks/useIntersection';

const { useBreakpoint } = Grid;

type SortOption = 'dateAdded:desc' | 'title:asc' | 'correspondent:asc';

export function DocumentsPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [sort, setSort] = useState<SortOption>('dateAdded:desc');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);

  const [sortField, sortOrder] = sort.split(':') as [string, string];

  const { ref: sentinelRef, isIntersecting } = useIntersection({
    rootMargin: '200% 0px',
  });

  const { data: tags } = useQuery(documentQueries.tags());

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: [
      'documents',
      'list',
      { sort: sortField, order: sortOrder, tags: selectedTags.join(','), query: search },
    ],
    queryFn: ({ pageParam }) =>
      api
        .get('api/v1/documents', {
          searchParams: {
            page: pageParam,
            pageSize: DEFAULT_PAGE_SIZE,
            sort: sortField,
            order: sortOrder,
            ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
            ...(search && { query: search }),
          },
        })
        .json<DocumentListResponse>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
  });

  const allDocuments = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const totalCount = data?.pages[0]?.total ?? 0;

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleCardClick = useCallback(
    (doc: Document) => {
      setSelectedDoc(doc);
    },
    [],
  );

  const handleDownload = useCallback(() => {
    if (selectedDoc) {
      window.open(selectedDoc.downloadUrl, '_blank');
    }
  }, [selectedDoc]);

  return (
    <>
      {/* Filter bar */}
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
          flexWrap: isMobile ? 'wrap' : undefined,
        }}
      >
        <Select
          value={sort}
          onChange={setSort}
          size="small"
          style={{ width: 160 }}
          options={[
            { value: 'dateAdded:desc', label: 'Recently added' },
            { value: 'title:asc', label: 'Title A-Z' },
            { value: 'correspondent:asc', label: 'Correspondent' },
          ]}
        />
        <Select
          mode="multiple"
          value={selectedTags}
          onChange={setSelectedTags}
          size="small"
          placeholder="Filter by tags"
          allowClear
          style={{ minWidth: 180, flex: isMobile ? 1 : undefined }}
          maxTagCount="responsive"
          options={
            tags?.map((t) => ({
              value: t.name,
              label: t.name,
            })) ?? []
          }
        />
        <Input.Search
          placeholder="Search documents..."
          size="small"
          allowClear
          onSearch={setSearch}
          style={{ width: isMobile ? '100%' : 200 }}
        />
        <div style={{ flex: 1 }} />
        {totalCount > 0 && !isMobile && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {totalCount.toLocaleString()} documents
          </Typography.Text>
        )}
      </div>

      {/* Document grid */}
      <div style={{ padding: 16, minHeight: 'calc(100vh - 120px)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allDocuments.length === 0 ? (
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
            <FileText size={64} weight="duotone" />
            <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
              No documents yet
            </Typography.Title>
            <Typography.Text type="secondary">
              Upload your first documents to get started
            </Typography.Text>
          </div>
        ) : (
          <motion.div
            variants={gridContainer}
            initial="hidden"
            animate="visible"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 160 : 220}px, 1fr))`,
              gap: 16,
            }}
          >
            {allDocuments.map((doc) => (
              <motion.div
                key={doc.id}
                variants={gridItem}
                className="doc-card"
                onClick={() => handleCardClick(doc)}
                style={{
                  cursor: 'pointer',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: 'var(--ant-color-bg-container)',
                  transition: 'box-shadow 150ms ease-out',
                }}
              >
                {/* Thumbnail */}
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '3 / 4',
                    overflow: 'hidden',
                    background: 'var(--ant-color-bg-layout)',
                  }}
                >
                  <img
                    src={doc.thumbnailUrl}
                    alt={doc.title}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                </div>

                {/* Info */}
                <div style={{ padding: '10px 12px' }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      lineHeight: '18px',
                      minHeight: 36,
                    }}
                  >
                    {doc.title}
                  </div>

                  {doc.correspondent && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--ant-color-text-secondary)',
                        marginTop: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {doc.correspondent}
                    </div>
                  )}

                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ant-color-text-tertiary)',
                      marginTop: 4,
                    }}
                  >
                    {new Date(doc.dateCreated).toLocaleDateString()}
                  </div>

                  {doc.tags.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 4,
                        marginTop: 8,
                      }}
                    >
                      {doc.tags.slice(0, 3).map((tag) => (
                        <Tag
                          key={tag}
                          style={{ fontSize: 10, lineHeight: '18px', margin: 0 }}
                        >
                          {tag}
                        </Tag>
                      ))}
                      {doc.tags.length > 3 && (
                        <Tag style={{ fontSize: 10, lineHeight: '18px', margin: 0 }}>
                          +{doc.tags.length - 3}
                        </Tag>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
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

      {/* Document viewer drawer */}
      <Drawer
        open={selectedDoc !== null}
        onClose={() => setSelectedDoc(null)}
        width={isMobile ? '100%' : '80%'}
        closable
        title={null}
        styles={{ body: { padding: 0, height: '100%' } }}
      >
        {selectedDoc && (
          <DocumentViewer
            previewUrl={selectedDoc.previewUrl}
            document={{
              title: selectedDoc.title,
              correspondent: selectedDoc.correspondent,
              tags: selectedDoc.tags,
              dateCreated: selectedDoc.dateCreated,
              pageCount: selectedDoc.pageCount,
            }}
            onDownload={handleDownload}
          />
        )}
      </Drawer>

      <style>{`
        .doc-card:hover {
          box-shadow: var(--sf-shadow-card);
          transform: translateY(-2px);
        }
      `}</style>
    </>
  );
}
