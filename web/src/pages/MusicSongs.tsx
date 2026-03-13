import { Spin } from 'antd';
import { MusicNote, Microphone, VinylRecord, Play } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import type { Track } from '@steadfirm/shared';
import { formatDuration } from '@steadfirm/shared';
import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ContentPage, NavRail, useContentList } from '@/components/content';
import { EmptyState } from '@/components/EmptyState';
import { useMusicPlayerStore } from '@/stores/music-player';
import { musicNavItems, handleMusicNav } from '@/pages/music-nav';

export function MusicSongsPage() {
  const navigate = useNavigate();
  const musicPlayer = useMusicPlayerStore();

  const { items: allTracks, sentinelRef, isLoading, isFetchingNextPage } =
    useContentList<Track>({
      queryKey: ['media', 'music', 'tracks', 'list'],
      endpoint: 'api/v1/media/music/tracks',
    });

  const handleNavChange = useCallback(
    (key: string) => handleMusicNav(key, navigate),
    [navigate],
  );

  const handleTrackClick = (track: Track, index: number) => {
    const queue = allTracks.slice(index);
    musicPlayer.play(track, queue);
  };

  return (
    <ContentPage
      sentinelRef={sentinelRef}
      isFetchingNextPage={isFetchingNextPage}
      navRail={
        <NavRail items={musicNavItems} activeKey="songs" onChange={handleNavChange} />
      }
    >
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : allTracks.length === 0 ? (
        <EmptyState
          icon={<MusicNote size={64} weight="duotone" />}
          title="No songs yet"
        />
      ) : (
        <div style={{ paddingTop: 12 }}>
          {/* Table header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 16px',
              borderBottom: '1px solid var(--ant-color-border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ant-color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            <span style={{ width: 32, textAlign: 'center' }}>#</span>
            <span style={{ flex: 1 }}>Title</span>
            <span style={{ width: 160 }}>Artist</span>
            <span style={{ width: 160 }}>Album</span>
            <span style={{ width: 60, textAlign: 'right' }}>Duration</span>
          </div>

          {/* Track rows */}
          {allTracks.map((track, index) => {
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
                }}
              >
                <span
                  style={{
                    width: 32,
                    textAlign: 'center',
                    fontSize: 12,
                    color: isCurrent ? cssVar.accent : 'var(--ant-color-text-secondary)',
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {isCurrent ? (
                    <Play size={14} weight="fill" />
                  ) : (
                    track.trackNumber ?? index + 1
                  )}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: isCurrent ? 600 : 400,
                      color: isCurrent ? cssVar.accent : 'var(--ant-color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {track.title}
                  </div>
                </div>
                <span
                  style={{
                    width: 160,
                    fontSize: 12,
                    color: 'var(--ant-color-text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {track.artistName ?? 'Unknown artist'}
                </span>
                <span
                  style={{
                    width: 160,
                    fontSize: 12,
                    color: 'var(--ant-color-text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {track.albumName ?? ''}
                </span>
                <span
                  style={{
                    width: 60,
                    textAlign: 'right',
                    fontSize: 12,
                    color: 'var(--ant-color-text-secondary)',
                  }}
                >
                  {formatDuration(track.duration)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .track-row:hover {
          background: var(--ant-color-bg-layout);
        }
      `}</style>
    </ContentPage>
  );
}
