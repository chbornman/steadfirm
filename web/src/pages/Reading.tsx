import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Typography, Spin, Grid } from 'antd';
import { BookOpenText, Books } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { PosterGrid } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import { overlay } from '@steadfirm/theme';
import type { Series } from '@steadfirm/shared';
import { readingQueries } from '@/api/reading';
import type { ReadingLibrary } from '@/api/reading';
import { ContentPage, NavRail, useContentList } from '@/components/content';
import type { NavRailItem } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';

const { useBreakpoint } = Grid;

export function ReadingPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [activeLibrary, setActiveLibrary] = useState<string | undefined>(undefined);

  const { data: libraries } = useQuery(readingQueries.libraries());

  // Default to the first library once loaded
  useEffect(() => {
    const first = libraries?.[0];
    if (first && activeLibrary === undefined) {
      setActiveLibrary(first.name);
    }
  }, [libraries, activeLibrary]);

  const { items: allSeries, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Series>({
      queryKey: ['reading', 'list', activeLibrary],
      endpoint: 'api/v1/reading',
      params: {
        ...(activeLibrary != null && { library: activeLibrary }),
      },
      enabled: activeLibrary !== undefined,
    });

  const inProgress = useMemo(
    () => allSeries.filter((s) => s.pagesRead > 0 && s.pagesRead < s.pages),
    [allSeries],
  );

  const posterItems: PosterGridItem[] = useMemo(
    () =>
      allSeries.map((s) => ({
        id: s.id,
        imageUrl: s.coverUrl,
        title: s.name,
        subtitle: s.format,
      })),
    [allSeries],
  );

  const handleSelect = (item: PosterGridItem) => {
    window.location.href = `/reading/${item.id}`;
  };

  // Build NavRail items from fetched libraries
  const navRailItems: NavRailItem[] = useMemo(
    () =>
      (libraries ?? []).map((lib: ReadingLibrary) => ({
        key: lib.name,
        label: lib.name,
        icon: lib.name.toLowerCase().includes('comic') ? (
          <Books size={18} />
        ) : (
          <BookOpenText size={18} />
        ),
      })),
    [libraries],
  );

  const handleNavChange = useCallback((key: string) => {
    setActiveLibrary(key);
  }, []);

  const heroSection = inProgress.length > 0 ? (
    <div style={{ paddingTop: 24, paddingBottom: 8 }}>
      <Typography.Title level={5} style={{ margin: '0 0 12px' }}>
        Continue Reading
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
          {inProgress.map((series) => (
            <ContinueCard key={series.id} series={series} isMobile={isMobile} />
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
      navRail={
        navRailItems.length > 1 ? (
          <NavRail
            items={navRailItems}
            activeKey={activeLibrary ?? ''}
            onChange={handleNavChange}
          />
        ) : undefined
      }
    >
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : allSeries.length === 0 ? (
        <EmptyState
          icon={<BookOpenText size={64} weight="duotone" />}
          title={`No ${activeLibrary?.toLowerCase() ?? 'items'} yet`}
          description="Upload your first ebook or comic to get started"
        />
      ) : (
        <div style={{ paddingTop: 16 }}>
          <Typography.Title level={5} style={{ margin: '0 0 12px' }}>
            {activeLibrary ?? 'Library'}
          </Typography.Title>
          <PosterGrid
            items={posterItems}
            onSelect={handleSelect}
            aspectRatio="2 / 3"
            hoverIcon={
              activeLibrary === 'Comics' ? (
                <Books size={40} weight="fill" color={overlay.text} />
              ) : (
                <BookOpenText size={40} weight="fill" color={overlay.text} />
              )
            }
          />
        </div>
      )}
    </ContentPage>
  );
}

function ContinueCard({
  series,
  isMobile,
}: {
  series: { id: string; name: string; coverUrl: string; pages: number; pagesRead: number };
  isMobile: boolean;
}) {
  const progress = series.pages > 0 ? series.pagesRead / series.pages : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => {
        window.location.href = `/reading/${series.id}`;
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
        <img
          src={series.coverUrl}
          alt={series.name}
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
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: 'var(--ant-color-primary)',
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
          {series.name}
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
