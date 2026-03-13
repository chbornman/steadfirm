import { Microphone, VinylRecord, MusicNote } from '@phosphor-icons/react';
import type { NavRailItem } from '@/components/content';

export const musicNavItems: NavRailItem[] = [
  { key: 'artists', label: 'Artists', icon: <Microphone size={18} /> },
  { key: 'albums', label: 'Albums', icon: <VinylRecord size={18} /> },
  { key: 'songs', label: 'Songs', icon: <MusicNote size={18} /> },
];

export function handleMusicNav(
  key: string,
  navigate: (opts: { to: string }) => void,
) {
  const routes: Record<string, string> = {
    artists: '/music',
    albums: '/music/albums',
    songs: '/music/songs',
  };
  void navigate({ to: routes[key] ?? '/music' });
}
