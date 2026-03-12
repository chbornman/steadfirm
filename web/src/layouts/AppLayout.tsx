import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Layout, Dropdown, Avatar, Grid } from 'antd';
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion';
import type { IconWeight } from '@phosphor-icons/react';
import {
  ImagesSquare,
  FilmSlate,
  MusicNote,
  FileText,
  Headphones,
  BookOpenText,
  Folder,
  CloudArrowUp,
  MagnifyingGlass,
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
import { useDebugStore, DEBUG_PANEL_WIDTH } from '@/stores/debug';
import type { TabKey } from '@/stores/preferences';
import { MusicPlayerManager } from '@/components/MusicPlayerManager';
import { AudiobookPlayerManager } from '@/components/AudiobookPlayerManager';
import { SearchModal } from '@/components/SearchModal';

const { useBreakpoint } = Grid;

interface AppLayoutProps {
  children: ReactNode;
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size: number; weight: IconWeight }>;
  matchPrefix?: string;
}

const navItems: NavItem[] = [
  { key: '/photos', label: 'Personal Media', icon: ImagesSquare },
  { key: '/media/movies', label: 'Film & TV', icon: FilmSlate, matchPrefix: '/media' },
  { key: '/music', label: 'Music', icon: MusicNote },
  { key: '/documents', label: 'Documents', icon: FileText },
  { key: '/audiobooks', label: 'Audiobooks', icon: Headphones },
  { key: '/reading', label: 'Reading', icon: BookOpenText },
  { key: '/files', label: 'Files', icon: Folder },
];

/** Shared spring config for animated transitions */
const navSpring = { type: 'spring', stiffness: 400, damping: 30 } as const;

/** Tabs that are always shown regardless of visibility settings. */
const alwaysVisibleKeys = new Set<string>();

// ─── Shared NavTab component ─────────────────────────────────────────

interface NavTabProps {
  item: NavItem;
  isActive: boolean;
  layoutId: string;
  onClick: () => void;
  iconSize?: number;
}

/** A single nav tab that expands to show its label when active. */
function NavTab({ item, isActive, layoutId, onClick, iconSize = 18 }: NavTabProps) {
  const Icon = item.icon;
  return (
    <motion.button
      layout
      onClick={onClick}
      transition={navSpring}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isActive ? 7 : 0,
        padding: isActive ? '7px 16px' : '7px 12px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: isActive ? '#fff' : 'var(--ant-color-text-secondary)',
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        fontFamily: 'inherit',
        borderRadius: 9999,
        zIndex: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {/* Animated pill background */}
      <AnimatePresence>
        {isActive && (
          <motion.span
            layoutId={layoutId}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={navSpring}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 9999,
              background: cssVar.accent,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
              zIndex: -1,
            }}
          />
        )}
      </AnimatePresence>

      <motion.span layout="position" style={{ display: 'flex', flexShrink: 0 }}>
        <Icon size={iconSize} weight={isActive ? 'fill' : 'regular'} />
      </motion.span>

      <AnimatePresence initial={false}>
        {isActive && (
          <motion.span
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ ...navSpring, opacity: { duration: 0.15 } }}
            style={{ overflow: 'hidden', display: 'inline-block' }}
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

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

  const debugVisible = useDebugStore((s) => s.visible);
  const debugMargin = !import.meta.env.PROD && debugVisible ? DEBUG_PANEL_WIDTH : 0;

  const ThemeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Desktop;
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const keepOpenRef = useRef(false);

  // Global Cmd+K / Ctrl+K shortcut to open search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
    <Layout style={{ minHeight: '100vh', marginRight: debugMargin, transition: 'margin-right 0.25s ease' }}>
      {/* Desktop header */}
      {!isMobile && (
        <Layout.Header
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: debugMargin,
            zIndex: 100,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--ant-color-border)',
            transition: 'right 0.25s ease',
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
            <LayoutGroup id="desktop-nav">
              <nav
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: 4,
                  borderRadius: 9999,
                  background: 'var(--ant-color-fill-quaternary)',
                }}
              >
                {visibleNavItems.map((item) => (
                  <NavTab
                    key={item.key}
                    item={item}
                    isActive={activeKey === item.key}
                    layoutId="desktop-pill"
                    onClick={() => handleNav(item.key)}
                    iconSize={16}
                  />
                ))}
              </nav>
            </LayoutGroup>
          </div>

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setSearchOpen(true)}
              title="Search (Cmd+K)"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 34,
                height: 34,
                border: '1px solid var(--ant-color-border)',
                borderRadius: 9999,
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--ant-color-text-secondary)',
                transition: 'border-color 0.15s ease',
              }}
            >
              <MagnifyingGlass size={18} />
            </button>

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
            right: debugMargin,
            zIndex: 100,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--ant-color-border)',
            transition: 'right 0.25s ease',
          }}
        >
          <Wordmark size={22} onClick={() => handleNav('/photos')} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                border: 'none',
                borderRadius: 9999,
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--ant-color-text-secondary)',
              }}
            >
              <MagnifyingGlass size={20} />
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
        <LayoutGroup id="mobile-nav">
          <nav
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: debugMargin,
              zIndex: 100,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '0 12px',
              background: 'var(--ant-color-bg-container)',
              borderTop: '1px solid var(--ant-color-border)',
              transition: 'right 0.25s ease',
            }}
          >
            {[...visibleNavItems, { key: '/upload', label: 'Upload', icon: CloudArrowUp }].map((item) => {
              const isActive =
                'matchPrefix' in item && item.matchPrefix
                  ? currentPath.startsWith(item.matchPrefix)
                  : currentPath === item.key || currentPath.startsWith(item.key);
              return (
                <NavTab
                  key={item.key}
                  item={item}
                  isActive={isActive}
                  layoutId="mobile-pill"
                  onClick={() => handleNav(item.key)}
                  iconSize={20}
                />
              );
            })}
          </nav>
        </LayoutGroup>
      )}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}
