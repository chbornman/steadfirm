import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Typography, Spin, Grid } from 'antd';
import { Headphones } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { PosterGrid, CoverImage } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import { gridItem, overlay, cssVar } from '@steadfirm/theme';
import type { Audiobook } from '@steadfirm/shared';
import { ContentPage, useContentList } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';

const { useBreakpoint } = Grid;

export function AudiobooksPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const { items: allBooks, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Audiobook>({
      queryKey: ['audiobooks', 'list'],
      endpoint: 'api/v1/audiobooks',
    });

  const inProgress = useMemo(
    () => allBooks.filter((b) => b.progress != null && b.progress > 0 && b.progress < 1),
    [allBooks],
  );

  const posterItems: PosterGridItem[] = useMemo(
    () =>
      allBooks.map((b) => ({
        id: b.id,
        imageUrl: b.coverUrl,
        title: b.title,
        subtitle: b.author,
      })),
    [allBooks],
  );

  const handleSelect = (item: PosterGridItem) => {
    void navigate({ to: '/audiobooks/$bookId', params: { bookId: item.id } });
  };

  const heroSection = inProgress.length > 0 ? (
    <div style={{ paddingTop: 24, paddingBottom: 8 }}>
      <Typography.Title level={5} style={{ margin: '0 0 12px' }}>
        Continue Listening
      </Typography.Title>
      <div
        style={{
          display: 'flex',
          gap: 16,
          overflowX: 'auto',
          paddingBottom: 8,
          scrollbarWidth: 'thin',
        }}
      >
        <AnimatePresence>
          {inProgress.map((book) => (
            <ContinueCard key={book.id} book={book} isMobile={isMobile} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  ) : undefined;

  return (
    <ContentPage
      sentinelRef={sentinelRef}
      isFetchingNextPage={isFetchingNextPage}
      hero={heroSection}
    >
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : allBooks.length === 0 ? (
        <EmptyState
          icon={<Headphones size={64} weight="duotone" />}
          title="No audiobooks yet"
          description="Upload your first audiobook to get started"
        />
      ) : (
        <div style={{ paddingTop: 16 }}>
          <Typography.Title level={5} style={{ margin: '0 0 12px' }}>
            Library
          </Typography.Title>
          <PosterGrid
            items={posterItems}
            onSelect={handleSelect}
            aspectRatio="2 / 3"
            hoverIcon={<Headphones size={40} weight="fill" color={overlay.text} />}
          />
        </div>
      )}
    </ContentPage>
  );
}

function ContinueCard({ book, isMobile }: { book: Audiobook; isMobile: boolean }) {
  const navigate = useNavigate();
  const progress = book.progress ?? 0;

  return (
    <motion.div
      variants={gridItem}
      initial="hidden"
      animate="visible"
      onClick={() => {
        void navigate({ to: '/audiobooks/$bookId', params: { bookId: book.id } });
      }}
      style={{
        flexShrink: 0,
        width: isMobile ? 140 : 160,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '2 / 3',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--ant-color-bg-container)',
        }}
      >
        <CoverImage
          src={book.coverUrl}
          alt={book.title}
          iconSize={32}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: overlay.scrimLight,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: cssVar.accent,
              borderRadius: '0 2px 2px 0',
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: 6, padding: '0 2px' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {book.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ant-color-text-secondary)',
            marginTop: 2,
          }}
        >
          {Math.round(progress * 100)}% complete
        </div>
      </div>
    </motion.div>
  );
}
