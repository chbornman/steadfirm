import { useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Typography, Spin, Button } from 'antd';
import { ArrowLeft, Play, MusicNote } from '@phosphor-icons/react';
import { colors } from '@steadfirm/theme';
import type { Album, Track } from '@steadfirm/shared';
import { formatDuration } from '@steadfirm/shared';
import { musicQueries } from '@/api/media';
import { useMusicPlayerStore } from '@/stores/music-player';

export function MediaMusicArtistPage() {
  const { artistId } = useParams({ from: '/media/music/$artistId' as never });
  const navigate = useNavigate();
  const musicPlayer = useMusicPlayerStore();

  const { data: albums, isLoading } = useQuery({
    ...musicQueries.artistAlbums(artistId),
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  const typedAlbums: Album[] = albums ?? [];

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 24px 64px' }}>
      {/* Back button */}
      <button
        onClick={() => void navigate({ to: '/media/music' })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--ant-color-text-secondary)',
          padding: 0,
          marginBottom: 24,
          fontSize: 14,
          fontFamily: 'inherit',
        }}
      >
        <ArrowLeft size={18} /> Back to artists
      </button>

      {/* Album list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {typedAlbums.map((album) => (
          <AlbumSection key={album.id} album={album} onPlayAlbum={(tracks) => {
            if (tracks.length > 0 && tracks[0]) {
              musicPlayer.play(tracks[0], tracks);
            }
          }} />
        ))}
      </div>

      {typedAlbums.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--ant-color-text-secondary)' }}>
          <MusicNote size={48} weight="duotone" />
          <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
            No albums found
          </Typography.Title>
        </div>
      )}
    </div>
  );
}

function AlbumSection({ album, onPlayAlbum }: { album: Album; onPlayAlbum: (tracks: Track[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  const musicPlayer = useMusicPlayerStore();

  const { data: tracks } = useQuery({
    ...musicQueries.albumTracks(album.id),
    enabled: expanded,
  });

  const typedTracks: Track[] = tracks ?? [];

  const handleTrackClick = (track: Track, index: number) => {
    const remainingQueue = typedTracks.slice(index);
    musicPlayer.play(track, remainingQueue);
  };

  return (
    <div
      style={{
        background: 'var(--ant-color-bg-container)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Album header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: 12,
          cursor: 'pointer',
        }}
      >
        <img
          src={album.imageUrl}
          alt={album.name}
          style={{ width: 80, height: 80, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong style={{ fontSize: 15 }}>{album.name}</Typography.Text>
          <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginTop: 2 }}>
            {album.year} &middot; {album.trackCount} tracks
          </div>
          <Button
            size="small"
            type="text"
            icon={<Play size={14} weight="fill" />}
            onClick={(e) => {
              e.stopPropagation();
              if (typedTracks.length > 0) {
                onPlayAlbum(typedTracks);
              } else {
                setExpanded(true);
              }
            }}
            style={{ color: colors.accent, padding: '0 8px', marginTop: 4, fontSize: 12 }}
          >
            Play Album
          </Button>
        </div>
      </div>

      {/* Track list */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--ant-color-border)' }}>
          {typedTracks.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <Spin size="small" />
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
                    padding: '8px 16px',
                    cursor: 'pointer',
                    transition: 'background 100ms ease',
                    borderLeft: isCurrent ? `3px solid ${colors.accent}` : '3px solid transparent',
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      textAlign: 'center',
                      fontSize: 12,
                      color: isCurrent ? colors.accent : 'var(--ant-color-text-secondary)',
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                  >
                    {track.trackNumber}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: isCurrent ? 600 : 400,
                      color: isCurrent ? colors.accent : 'var(--ant-color-text)',
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
      )}

      <style>{`
        .track-row:hover {
          background: var(--ant-color-bg-layout);
        }
      `}</style>
    </div>
  );
}
