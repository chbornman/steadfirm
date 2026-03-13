import { useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Typography, Spin, Button } from 'antd';
import { ArrowLeft, Play, MusicNote } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import type { Album, Track } from '@steadfirm/shared';
import { formatDuration } from '@steadfirm/shared';
import { musicQueries } from '@/api/media';
import { useMusicPlayerStore } from '@/stores/music-player';

export function MediaMusicArtistPage() {
  const { artistId } = useParams({ from: '/app/music/$artistId' });
  const navigate = useNavigate();
  const musicPlayer = useMusicPlayerStore();

  const { data: artist } = useQuery({
    ...musicQueries.artistDetail(artistId),
  });

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
        onClick={() => void navigate({ to: '/music' })}
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
        <ArrowLeft size={18} /> Back to artists
      </button>

      {/* Artist header */}
      {artist && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 32, alignItems: 'center' }}>
          <div
            style={{
              width: 160,
              height: 160,
              borderRadius: '50%',
              overflow: 'hidden',
              background: 'var(--ant-color-bg-container)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {artist.imageUrl ? (
              <img
                src={artist.imageUrl}
                alt={artist.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <MusicNote size={48} weight="duotone" color="var(--ant-color-text-quaternary)" />
            )}
          </div>
          <div>
            <Typography.Title level={2} style={{ margin: 0 }}>
              {artist.name}
            </Typography.Title>
            <div style={{ fontSize: 14, color: 'var(--ant-color-text-secondary)', marginTop: 4 }}>
              {artist.albumCount != null ? `${artist.albumCount} albums` : `${typedAlbums.length} albums`}
            </div>
          </div>
        </div>
      )}

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
            {[album.year, album.trackCount != null ? `${album.trackCount} tracks` : null].filter(Boolean).join(' \u00b7 ')}
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
            style={{ color: cssVar.accent, padding: '0 8px', marginTop: 4, fontSize: 12 }}
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
                    borderLeft: isCurrent ? `3px solid ${cssVar.accent}` : '3px solid transparent',
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
                    {track.trackNumber}
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
      )}

      <style>{`
        .track-row:hover {
          background: var(--ant-color-bg-layout);
        }
      `}</style>
    </div>
  );
}
