import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Layout, Dropdown, Avatar, Grid } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
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
  Gear,
  SignOut,
  User,
} from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { Wordmark } from '@steadfirm/ui';
import { useTheme } from '@/hooks/useTheme';
import { signOut } from '@/hooks/useAuth';
import { useMusicPlayerStore } from '@/stores/music-player';
import { useAudiobookPlayerStore } from '@/stores/audiobook-player';
import { usePreferencesStore } from '@/stores/preferences';
import type { TabKey } from '@/stores/preferences';
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

/** Shared spring config for the sliding pill indicator */
const pillSpring = { type: 'spring', stiffness: 500, damping: 35 } as const;

/** Tabs that are always shown regardless of visibility settings. */
const alwaysVisibleKeys = new Set<string>();

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
  const [menuOpen, setMenuOpen] = useState(false);
  const keepOpenRef = useRef(false);

  const handleMenuOpenChange = useCallback((open: boolean) => {
    if (!open && keepOpenRef.current) {
      keepOpenRef.current = false;
      return;
    }
    setMenuOpen(open);
  }, []);

  const showAllTabs = usePreferencesStore((s) => s.showAllTabs);
  const hiddenTabs = usePreferencesStore((s) => s.hiddenTabs);

  const visibleNavItems = useMemo(
    () =>
      navItems.filter(
        (item) =>
          alwaysVisibleKeys.has(item.key) ||
          showAllTabs ||
          !hiddenTabs.includes(item.key as TabKey),
      ),
    [showAllTabs, hiddenTabs],
  );

  const activeKey =
    visibleNavItems.find(
      (item) =>
        currentPath === item.key ||
        (item.matchPrefix && currentPath.startsWith(item.matchPrefix)),
    )?.key ?? null;

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
      key: 'settings',
      label: 'Settings',
      icon: <Gear size={16} />,
      onClick: () => handleNav('/settings'),
    },
    {
      key: 'theme',
      label: `Theme: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`,
      icon: <ThemeIcon size={16} />,
      onClick: () => { keepOpenRef.current = true; cycleMode(); },
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
          {/* Logo — left pinned */}
          <Wordmark
            size={24}
            onClick={() => handleNav('/photos')}
            style={{ flexShrink: 0 }}
          />

          {/* Centered floating pill nav */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <nav
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: 4,
                borderRadius: 9999,
                background: 'var(--ant-color-fill-quaternary)',
                position: 'relative',
              }}
            >
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeKey === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => handleNav(item.key)}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 14px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: isActive
                        ? '#fff'
                        : 'var(--ant-color-text-secondary)',
                      fontWeight: isActive ? 600 : 400,
                      fontSize: 13,
                      fontFamily: 'inherit',
                      borderRadius: 9999,
                      zIndex: 1,
                      transition: 'color 0.2s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {/* Animated pill background */}
                    <AnimatePresence>
                      {isActive && (
                        <motion.span
                          layoutId="nav-pill"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={pillSpring}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: 9999,
                            background: cssVar.accent,
                            boxShadow:
                              '0 2px 8px rgba(0, 0, 0, 0.15)',
                            zIndex: -1,
                          }}
                        />
                      )}
                    </AnimatePresence>
                    <Icon size={16} weight={isActive ? 'fill' : 'regular'} />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => handleNav('/upload')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                border: '1px solid var(--ant-color-border)',
                borderRadius: 9999,
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--ant-color-text-secondary)',
                fontSize: 13,
                fontFamily: 'inherit',
                transition: 'border-color 0.15s ease',
              }}
            >
              <CloudArrowUp size={18} />
              Upload
            </button>

            <Dropdown
              open={menuOpen}
              onOpenChange={handleMenuOpenChange}
              menu={{ items: userMenuItems, style: { minWidth: 180 } }}
              trigger={['click']}
            >
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
          <Wordmark size={22} onClick={() => handleNav('/photos')} />
          <Dropdown
            open={menuOpen}
            onOpenChange={handleMenuOpenChange}
            menu={{ items: userMenuItems, style: { minWidth: 180 } }}
            trigger={['click']}
          >
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
          {[...visibleNavItems, { key: '/upload', label: 'Upload', icon: CloudArrowUp }].map((item) => {
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
                  position: 'relative',
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
                  transition: 'color 0.2s ease',
                }}
              >
                {/* Active dot indicator for mobile */}
                {isActive && (
                  <motion.span
                    layoutId="mobile-nav-dot"
                    transition={pillSpring}
                    style={{
                      position: 'absolute',
                      top: 0,
                      width: 4,
                      height: 4,
                      borderRadius: 9999,
                      background: cssVar.accent,
                    }}
                  />
                )}
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
