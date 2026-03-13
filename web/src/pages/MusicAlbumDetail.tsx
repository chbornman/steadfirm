import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Typography, Spin, Button } from 'antd';
import { ArrowLeft, Play, MusicNote, VinylRecord } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import type { Track } from '@steadfirm/shared';
import { formatDuration } from '@steadfirm/shared';
import { musicQueries } from '@/api/media';
import { useMusicPlayerStore } from '@/stores/music-player';

export function MusicAlbumDetailPage() {
  const { albumId } = useParams({ from: '/app/music/albums/$albumId' });
  const navigate = useNavigate();
  const musicPlayer = useMusicPlayerStore();

  const { data: album, isLoading: albumLoading } = useQuery({
    ...musicQueries.albumDetail(albumId),
  });

  const { data: tracks, isLoading: tracksLoading } = useQuery({
    ...musicQueries.albumTracks(albumId),
  });

  const typedTracks: Track[] = tracks ?? [];
  const isLoading = albumLoading || tracksLoading;

  const handleTrackClick = (track: Track, index: number) => {
    const remainingQueue = typedTracks.slice(index);
    musicPlayer.play(track, remainingQueue);
  };

  const handlePlayAll = () => {
    if (typedTracks.length > 0 && typedTracks[0]) {
      musicPlayer.play(typedTracks[0], typedTracks);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 24px 64px' }}>
      {/* Back button */}
      <button
        onClick={() => void navigate({ to: '/music/albums' })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--ant-color-text-secondary)',
          padding: 0,
          marginBottom: 24,
          fontSize: 14,
          fontFamily: 'inherit',
        }}
      >
        <ArrowLeft size={18} /> Back to albums
      </button>

      {/* Album header */}
      {album && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 32, alignItems: 'flex-end' }}>
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: 8,
              overflow: 'hidden',
              background: 'var(--ant-color-bg-container)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {album.imageUrl ? (
              <img
                src={album.imageUrl}
                alt={album.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <VinylRecord size={64} weight="duotone" color="var(--ant-color-text-quaternary)" />
            )}
          </div>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {album.name}
            </Typography.Title>
            <div style={{ fontSize: 14, color: 'var(--ant-color-text-secondary)', marginTop: 4 }}>
              {[album.artistName, album.year, album.trackCount != null ? `${album.trackCount} tracks` : null]
                .filter(Boolean)
                .join(' \u00b7 ')}
            </div>
            <Button
              type="primary"
              icon={<Play size={16} weight="fill" />}
              onClick={handlePlayAll}
              disabled={typedTracks.length === 0}
              style={{ marginTop: 16, background: cssVar.accent, borderColor: cssVar.accent }}
            >
              Play All
            </Button>
          </div>
        </div>
      )}

      {/* Track list */}
      <div style={{ background: 'var(--ant-color-bg-container)', borderRadius: 8, overflow: 'hidden' }}>
        {typedTracks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--ant-color-text-secondary)' }}>
            <MusicNote size={48} weight="duotone" />
            <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
              No tracks found
            </Typography.Title>
          </div>
        ) : (
          typedTracks.map((track, index) => {
            const isCurrent =
              musicPlayer.queue[musicPlayer.currentIndex]?.id === track.id;
            return (
              <div
                key={track.id}
                onClick={() => handleTrackClick(track, index)}
                className="track-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  transition: 'background 100ms ease',
                  borderLeft: isCurrent ? `3px solid ${cssVar.accent}` : '3px solid transparent',
                  borderBottom: index < typedTracks.length - 1 ? '1px solid var(--ant-color-border-secondary)' : 'none',
                }}
              >
                <span
                  style={{
                    width: 24,
                    textAlign: 'center',
                    fontSize: 12,
                    color: isCurrent ? cssVar.accent : 'var(--ant-color-text-secondary)',
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {track.trackNumber ?? index + 1}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: isCurrent ? 600 : 400,
                    color: isCurrent ? cssVar.accent : 'var(--ant-color-text)',
                  }}
                >
                  {track.title}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                  {formatDuration(track.duration)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .track-row:hover {
          background: var(--ant-color-bg-layout);
        }
      `}</style>
    </div>
  );
}
