import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spin, Tag, Grid } from 'antd';
import { FileText } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { DocumentViewer, MediaViewer } from '@steadfirm/ui';
import { gridContainer, gridItem } from '@steadfirm/theme';
import type { Document } from '@steadfirm/shared';
import { documentQueries } from '@/api/documents';
import { ContentPage, FilterRail, useContentList } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';

const { useBreakpoint } = Grid;

type SortOption = 'dateAdded:desc' | 'title:asc' | 'correspondent:asc';

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'dateAdded:desc', label: 'Recently added' },
  { value: 'title:asc', label: 'Title A-Z' },
  { value: 'correspondent:asc', label: 'Correspondent' },
];

export function DocumentsPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [sort, setSort] = useState<SortOption>('dateAdded:desc');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);

  const [sortField, sortOrder] = sort.split(':') as [string, string];

  const { data: tags } = useQuery(documentQueries.tags());

  const { items: allDocuments, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Document>({
      queryKey: [
        'documents',
        'list',
        { sort: sortField, order: sortOrder, tags: selectedTags.join(','), query: search },
      ],
      endpoint: 'api/v1/documents',
      params: {
        sort: sortField,
        order: sortOrder,
        ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
        ...(search && { query: search }),
      },
    });

  const handleCardClick = useCallback((doc: Document) => {
    setSelectedDoc(doc);
  }, []);

  const handleDownload = useCallback(() => {
    if (selectedDoc) {
      window.open(selectedDoc.downloadUrl, '_blank');
    }
  }, [selectedDoc]);

  return (
    <>
      <ContentPage
        sentinelRef={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        filterRail={
          <FilterRail>
            <FilterRail.Sort value={sort} onChange={setSort} options={sortOptions} />
            <FilterRail.Tags
              value={selectedTags}
              onChange={setSelectedTags}
              options={tags?.map((t) => ({ value: t.name, label: t.name })) ?? []}
            />
            <FilterRail.Search onSearch={setSearch} placeholder="Search documents..." />
          </FilterRail>
        }
      >
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spin size="large" />
          </div>
        ) : allDocuments.length === 0 ? (
          <EmptyState
            icon={<FileText size={64} weight="duotone" />}
            title="No documents yet"
            description="Upload your first documents to get started"
          />
        ) : (
          <motion.div
            variants={gridContainer}
            initial="hidden"
            animate="visible"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 160 : 220}px, 1fr))`,
              gap: 16,
              paddingTop: 16,
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
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      {doc.tags.slice(0, 3).map((tag) => (
                        <Tag key={tag} style={{ fontSize: 10, lineHeight: '18px', margin: 0 }}>
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
      </ContentPage>

      {/* Document viewer lightbox */}
      <MediaViewer
        open={selectedDoc !== null}
        onClose={() => setSelectedDoc(null)}
        maxWidth={isMobile ? '100vw' : 1200}
        maxHeight={isMobile ? '100vh' : '90vh'}
      >
        {selectedDoc && (
          <DocumentViewer
            previewUrl={selectedDoc.previewUrl}
            downloadUrl={selectedDoc.downloadUrl}
            document={{
              title: selectedDoc.title,
              correspondent: selectedDoc.correspondent,
              tags: selectedDoc.tags,
              dateCreated: selectedDoc.dateCreated,
              pageCount: selectedDoc.pageCount,
              mimeType: selectedDoc.mimeType,
              originalFileName: selectedDoc.originalFileName,
              hasArchiveVersion: selectedDoc.hasArchiveVersion,
            }}
            onDownload={handleDownload}
          />
        )}
      </MediaViewer>

      <style>{`
        .doc-card:hover {
          box-shadow: var(--sf-shadow-card);
          transform: translateY(-2px);
        }
      `}</style>
    </>
  );
}
