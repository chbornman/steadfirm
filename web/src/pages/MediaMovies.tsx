import { useState, useMemo, useCallback } from 'react';
import { Spin, Typography, Button, Grid } from 'antd';
import { Play, FilmSlate, Television } from '@phosphor-icons/react';
import { PosterGrid, VideoPlayer, MediaViewer } from '@steadfirm/ui';
import type { PosterGridItem } from '@steadfirm/ui';
import { overlay, cssVar } from '@steadfirm/theme';
import type { Movie } from '@steadfirm/shared';
import { ContentPage, FilterRail, NavRail, useContentList } from '@/components/content';
import type { NavRailItem } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';
import { useNavigate } from '@tanstack/react-router';

const { useBreakpoint } = Grid;

type SortOption = 'title:asc' | 'dateAdded:desc' | 'year:desc';

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'title:asc', label: 'Title A-Z' },
  { value: 'dateAdded:desc', label: 'Recently added' },
  { value: 'year:desc', label: 'Year' },
];

const mediaNavItems: NavRailItem[] = [
  { key: 'movies', label: 'Movies', icon: <FilmSlate size={18} /> },
  { key: 'shows', label: 'Shows', icon: <Television size={18} /> },
];

export function MediaMoviesPage() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [sort, setSort] = useState<SortOption>('title:asc');
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);

  const [sortField, sortOrder] = sort.split(':') as [string, string];

  const { items: allMovies, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Movie>({
      queryKey: ['media', 'movies', 'list', { sort: sortField, order: sortOrder }],
      endpoint: 'api/v1/media/movies',
      params: { sort: sortField, order: sortOrder },
    });

  const posterItems: PosterGridItem[] = useMemo(
    () =>
      allMovies.map((m) => ({
        id: m.id,
        imageUrl: m.imageUrl,
        title: m.title,
        subtitle: String(m.year),
      })),
    [allMovies],
  );

  const handleSelect = useCallback(
    (item: PosterGridItem) => {
      const movie = allMovies.find((m) => m.id === item.id);
      if (movie) {
        setSelectedMovie(movie);
        setShowPlayer(false);
      }
    },
    [allMovies],
  );

  const handleNavChange = useCallback(
    (key: string) => {
      if (key === 'shows') {
        void navigate({ to: '/media/shows' });
      }
    },
    [navigate],
  );

  return (
    <>
      <ContentPage
        sentinelRef={sentinelRef}
        isFetchingNextPage={isFetchingNextPage}
        navRail={
          <NavRail items={mediaNavItems} activeKey="movies" onChange={handleNavChange} />
        }
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
        ) : posterItems.length === 0 ? (
          <EmptyState
            icon={<Play size={64} weight="duotone" />}
            title="No movies yet"
          />
        ) : (
          <div style={{ paddingTop: 12 }}>
            <PosterGrid
              items={posterItems}
              onSelect={handleSelect}
              hoverIcon={<Play size={40} weight="fill" color={overlay.text} />}
            />
          </div>
        )}
      </ContentPage>

      {/* Movie detail lightbox */}
      <MediaViewer
        open={selectedMovie !== null}
        onClose={() => setSelectedMovie(null)}
        maxWidth={showPlayer ? 1100 : (isMobile ? '100vw' : 480)}
        maxHeight={isMobile ? '100vh' : '90vh'}
      >
        {selectedMovie && (
          <div style={{ width: '100%', overflow: 'auto' }}>
            {showPlayer ? (
              <VideoPlayer
                src={selectedMovie.streamUrl}
                poster={selectedMovie.imageUrl}
              />
            ) : (
              <div style={{ position: 'relative' }}>
                <img
                  src={selectedMovie.imageUrl}
                  alt={selectedMovie.title}
                  style={{
                    width: '100%',
                    aspectRatio: '2 / 3',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </div>
            )}
            <div style={{ padding: 20 }}>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {selectedMovie.title}
              </Typography.Title>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 8,
                  color: 'var(--ant-color-text-secondary)',
                  fontSize: 14,
                }}
              >
                <span>{selectedMovie.year}</span>
                <span>{selectedMovie.runtime} min</span>
                {selectedMovie.rating && <span>{selectedMovie.rating}</span>}
              </div>
              <Typography.Paragraph style={{ marginTop: 16 }} type="secondary">
                {selectedMovie.overview}
              </Typography.Paragraph>
              {!showPlayer && (
                <Button
                  type="primary"
                  size="large"
                  block
                  icon={<Play size={18} weight="fill" />}
                  onClick={() => setShowPlayer(true)}
                  style={{
                    marginTop: 16,
                    height: 48,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: cssVar.accent,
                  }}
                >
                  Play
                </Button>
              )}
            </div>
          </div>
        )}
      </MediaViewer>
    </>
  );
}
