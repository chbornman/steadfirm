import { useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Segmented, Typography, Drawer, Spin, Grid } from 'antd';
import { ArrowLeft, Play } from '@phosphor-icons/react';
import { VideoPlayer } from '@steadfirm/ui';
import { overlay } from '@steadfirm/theme';
import type { Season, Episode } from '@steadfirm/shared';
import { showQueries } from '@/api/media';

const { useBreakpoint } = Grid;

export function MediaShowDetailPage() {
  const { showId } = useParams({ from: '/media/shows/$showId' as never });
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);

  const { data: show, isLoading: loadingShow } = useQuery({
    ...showQueries.detail(showId),
  });

  const { data: seasons, isLoading: loadingSeasons } = useQuery({
    ...showQueries.seasons(showId),
  });

  // Auto-select first season
  const activeSeason = selectedSeasonId ?? seasons?.[0]?.id ?? null;

  const { data: episodes, isLoading: loadingEpisodes } = useQuery({
    ...showQueries.episodes(showId, activeSeason ?? ''),
    enabled: activeSeason !== null,
  });

  if (loadingShow || loadingSeasons) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!show) {
    return (
      <div style={{ padding: 24 }}>
        <Typography.Text type="secondary">Show not found</Typography.Text>
      </div>
    );
  }

  const typedShow = show;
  const typedSeasons: Season[] = seasons ?? [];

  return (
    <>
      {/* Hero section */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          minHeight: 300,
          background: overlay.heroGradient,
          overflow: 'hidden',
        }}
      >
        <img
          src={typedShow.imageUrl}
          alt={typedShow.title}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(20px) brightness(0.4)',
            transform: 'scale(1.1)',
          }}
        />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            maxWidth: 900,
            margin: '0 auto',
            padding: '32px 24px',
            display: 'flex',
            gap: 24,
            alignItems: isMobile ? 'center' : 'flex-end',
            flexDirection: isMobile ? 'column' : 'row',
          }}
        >
          <button
            onClick={() => void navigate({ to: '/media/shows' })}
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              background: overlay.scrim,
              border: 'none',
              borderRadius: 8,
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: overlay.text,
            }}
          >
            <ArrowLeft size={20} />
          </button>

          <img
            src={typedShow.imageUrl}
            alt={typedShow.title}
            style={{
              width: isMobile ? 140 : 200,
              aspectRatio: '2 / 3',
              objectFit: 'cover',
              borderRadius: 8,
              flexShrink: 0,
            }}
          />
          <div>
            <Typography.Title level={2} style={{ color: overlay.text, margin: 0 }}>
              {typedShow.title}
            </Typography.Title>
            <div style={{ color: overlay.textMuted, marginTop: 8 }}>
              {typedShow.year} &middot; {typedShow.seasonCount} season
              {typedShow.seasonCount !== 1 ? 's' : ''}
            </div>
            <Typography.Paragraph
              style={{ color: overlay.textSubtle, marginTop: 12, maxWidth: 500 }}
              ellipsis={{ rows: 3, expandable: true }}
            >
              {typedShow.overview}
            </Typography.Paragraph>
          </div>
        </div>
      </div>

      {/* Season selector */}
      {typedSeasons.length > 0 && (
        <div style={{ padding: '16px 24px', maxWidth: 900, margin: '0 auto' }}>
          <Segmented
            value={activeSeason ?? ''}
            onChange={(val) => { if (typeof val === 'string') setSelectedSeasonId(val); }}
            options={typedSeasons.map((s) => ({
              label: s.name,
              value: s.id,
            }))}
          />
        </div>
      )}

      {/* Episode list */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' }}>
        {loadingEpisodes ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
            <Spin />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {episodes?.map((ep: Episode) => (
              <div
                key={ep.id}
                onClick={() => setSelectedEpisode(ep)}
                className="episode-row"
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: 8,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 150ms ease',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: isMobile ? 120 : 200,
                    aspectRatio: '16 / 9',
                    borderRadius: 6,
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: 'var(--ant-color-bg-container)',
                  }}
                >
                  <img
                    src={ep.imageUrl}
                    alt={ep.title}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                  <div
                    className="episode-play-icon"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: overlay.scrimLight,
                      opacity: 0,
                      transition: 'opacity 150ms ease',
                    }}
                  >
                    <Play size={28} weight="fill" color={overlay.text} />
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>
                    <span style={{ color: 'var(--ant-color-text-secondary)', marginRight: 8 }}>
                      E{ep.episodeNumber}
                    </span>
                    {ep.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ant-color-text-secondary)',
                      marginTop: 4,
                    }}
                  >
                    {ep.runtime} min
                  </div>
                  {!isMobile && ep.overview && (
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--ant-color-text-secondary)',
                        marginTop: 6,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {ep.overview}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .episode-row:hover {
          background: var(--ant-color-bg-container);
        }
        .episode-row:hover .episode-play-icon {
          opacity: 1;
        }
      `}</style>

      {/* Episode player drawer */}
      <Drawer
        open={selectedEpisode !== null}
        onClose={() => setSelectedEpisode(null)}
        width={isMobile ? '100%' : 480}
        closable
        title={selectedEpisode?.title}
        styles={{ body: { padding: 0 } }}
      >
        {selectedEpisode && (
          <div>
            <VideoPlayer
              src={selectedEpisode.streamUrl}
              poster={selectedEpisode.imageUrl}
            />
            <div style={{ padding: 20 }}>
              <Typography.Text type="secondary">
                Season {selectedEpisode.seasonNumber}, Episode {selectedEpisode.episodeNumber}
              </Typography.Text>
              <Typography.Paragraph style={{ marginTop: 12 }}>
                {selectedEpisode.overview}
              </Typography.Paragraph>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
