import type { ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Layout, Dropdown, Avatar, Grid } from 'antd';
import {
  ImagesSquare,
  FilmSlate,
  MusicNote,
  FileText,
  Headphones,
  Folder,
  CloudArrowUp,
  Sun,
  Moon,
  Desktop,
  SignOut,
  User,
} from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { useTheme } from '@/hooks/useTheme';
import { signOut } from '@/hooks/useAuth';
import { useMusicPlayerStore } from '@/stores/music-player';
import { useAudiobookPlayerStore } from '@/stores/audiobook-player';
import { MusicPlayerManager } from '@/components/MusicPlayerManager';
import { AudiobookPlayerManager } from '@/components/AudiobookPlayerManager';

const { useBreakpoint } = Grid;

interface AppLayoutProps {
  children: ReactNode;
}

const navItems = [
  { key: '/photos', label: 'Personal Media', icon: ImagesSquare },
  { key: '/media/movies', label: 'Film & TV', icon: FilmSlate, matchPrefix: '/media' },
  { key: '/music', label: 'Music', icon: MusicNote },
  { key: '/documents', label: 'Documents', icon: FileText },
  { key: '/audiobooks', label: 'Audiobooks', icon: Headphones },
  { key: '/files', label: 'Files', icon: Folder },
];

export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { mode, cycleMode } = useTheme();

  const hasMusic = useMusicPlayerStore((s) => s.queue.length > 0);
  const musicLastActive = useMusicPlayerStore((s) => s.lastActiveAt);
  const hasAudiobook = useAudiobookPlayerStore((s) => s.book !== null);
  const audiobookLastActive = useAudiobookPlayerStore((s) => s.lastActiveAt);
  const hasPlayer = hasMusic || hasAudiobook;

  // Only one player bar visible — whichever was most recently started/resumed wins
  const showMusic = hasMusic && (!hasAudiobook || musicLastActive >= audiobookLastActive);
  const showAudiobook = hasAudiobook && !showMusic;

  const ThemeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Desktop;

  const activeKey =
    navItems.find(
      (item) =>
        currentPath === item.key ||
        (item.matchPrefix && currentPath.startsWith(item.matchPrefix)),
    )?.key ?? '/photos';

  const handleNav = (path: string) => {
    void navigate({ to: path });
  };

  const handleSignOut = () => {
    void signOut().then(() => {
      void navigate({ to: '/login' });
    });
  };

  const userMenuItems = [
    {
      key: 'theme',
      label: `Theme: ${mode}`,
      icon: <ThemeIcon size={16} />,
      onClick: cycleMode,
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'signout',
      label: 'Sign out',
      icon: <SignOut size={16} />,
      onClick: handleSignOut,
      danger: true,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Desktop header */}
      {!isMobile && (
        <Layout.Header
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--ant-color-border)',
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginRight: 32,
              cursor: 'pointer',
            }}
            onClick={() => handleNav('/photos')}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                background: cssVar.accent,
              }}
            />
            <span style={{ fontWeight: 600, fontSize: 16 }}>Steadfirm</span>
          </div>

          {/* Tab navigation */}
          <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeKey === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => handleNav(item.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderBottom: isActive ? `2px solid ${cssVar.accent}` : '2px solid transparent',
                    color: isActive ? 'var(--ant-color-text)' : 'var(--ant-color-text-secondary)',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    transition: 'color 0.15s, border-color 0.15s',
                    height: 55,
                  }}
                >
                  <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => handleNav('/upload')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                border: '1px solid var(--ant-color-border)',
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--ant-color-text-secondary)',
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            >
              <CloudArrowUp size={18} />
              Upload
            </button>

            <button
              onClick={cycleMode}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--ant-color-text-secondary)',
              }}
              title={`Theme: ${mode}`}
            >
              <ThemeIcon size={18} />
            </button>

            <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
              <Avatar
                size={32}
                icon={<User size={18} />}
                style={{ cursor: 'pointer', background: cssVar.avatarBg }}
              />
            </Dropdown>
          </div>
        </Layout.Header>
      )}

      {/* Mobile header */}
      {isMobile && (
        <Layout.Header
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--ant-color-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                background: cssVar.accent,
              }}
            />
            <span style={{ fontWeight: 600, fontSize: 16 }}>Steadfirm</span>
          </div>
          <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
            <Avatar
              size={32}
              icon={<User size={18} />}
              style={{ cursor: 'pointer', background: cssVar.avatarBg }}
            />
          </Dropdown>
        </Layout.Header>
      )}

      {/* Content area */}
      <Layout.Content
        style={{
          marginTop: 56,
          marginBottom: isMobile ? 56 + (hasPlayer ? 64 : 0) : hasPlayer ? 64 : 0,
          minHeight: `calc(100vh - 56px)`,
        }}
      >
        {children}
      </Layout.Content>

      {/* Persistent players (only one visible at a time — most recently active wins) */}
      {showMusic && <MusicPlayerManager />}
      {showAudiobook && <AudiobookPlayerManager />}

      {/* Mobile bottom tab bar */}
      {isMobile && (
        <nav
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            background: 'var(--ant-color-bg-container)',
            borderTop: '1px solid var(--ant-color-border)',
          }}
        >
          {[...navItems, { key: '/upload', label: 'Upload', icon: CloudArrowUp }].map((item) => {
            const Icon = item.icon;
            const isActive =
              'matchPrefix' in item && item.matchPrefix
                ? currentPath.startsWith(item.matchPrefix)
                : currentPath === item.key || currentPath.startsWith(item.key);
            return (
              <button
                key={item.key}
                onClick={() => handleNav(item.key)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  padding: 4,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: isActive ? cssVar.accent : 'var(--ant-color-text-secondary)',
                  fontSize: 10,
                  fontFamily: 'inherit',
                }}
              >
                <Icon size={22} weight={isActive ? 'fill' : 'regular'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </Layout>
  );
}
