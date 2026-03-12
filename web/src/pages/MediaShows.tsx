import { useMemo, useCallback } from 'react';
import { Spin } from 'antd';
import { Television, FilmSlate } from '@phosphor-icons/react';
import { PosterGrid } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import type { TvShow } from '@steadfirm/shared';
import { useNavigate } from '@tanstack/react-router';
import { ContentPage, NavRail, useContentList } from '@/components/content';
import type { NavRailItem } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';

const mediaNavItems: NavRailItem[] = [
  { key: 'movies', label: 'Movies', icon: <FilmSlate size={18} /> },
  { key: 'shows', label: 'Shows', icon: <Television size={18} /> },
];

export function MediaShowsPage() {
  const navigate = useNavigate();

  const { items: allShows, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<TvShow>({
      queryKey: ['media', 'shows', 'list'],
      endpoint: 'api/v1/media/shows',
    });

  const posterItems: PosterGridItem[] = useMemo(
    () =>
      allShows.map((s) => ({
        id: s.id,
        imageUrl: s.imageUrl,
        title: s.title,
        subtitle: `${s.year} - ${s.seasonCount} season${s.seasonCount !== 1 ? 's' : ''}`,
      })),
    [allShows],
  );

  const handleSelect = useCallback(
    (item: PosterGridItem) => {
      void navigate({ to: '/media/shows/$showId', params: { showId: item.id } });
    },
    [navigate],
  );

  const handleNavChange = useCallback(
    (key: string) => {
      if (key === 'movies') {
        void navigate({ to: '/media/movies' });
      }
    },
    [navigate],
  );

  return (
    <ContentPage
      sentinelRef={sentinelRef}
      isFetchingNextPage={isFetchingNextPage}
      navRail={
        <NavRail items={mediaNavItems} activeKey="shows" onChange={handleNavChange} />
      }
    >
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : posterItems.length === 0 ? (
        <EmptyState
          icon={<Television size={64} weight="duotone" />}
          title="No TV shows yet"
        />
      ) : (
        <div style={{ paddingTop: 12 }}>
          <PosterGrid items={posterItems} onSelect={handleSelect} />
        </div>
      )}
    </ContentPage>
  );
}
