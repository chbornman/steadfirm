export const colors = {
  neutral0: '#ffffff',
  neutral50: '#fafafa',
  neutral100: '#f5f5f5',
  neutral200: '#e5e5e5',
  neutral300: '#d4d4d4',
  neutral400: '#a3a3a3',
  neutral500: '#737373',
  neutral600: '#525252',
  neutral700: '#404040',
  neutral800: '#262626',
  neutral900: '#171717',
  neutral950: '#0a0a0a',

  accent: '#7C3AED',
  accentLight: '#A78BFA',
  accentDark: '#5B21B6',
  accentSubtle: '#EDE9FE',
  accentSubtleDark: '#4C1D95',

  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  photos: '#3B82F6',
  media: '#8B5CF6',
  documents: '#22C55E',
  audiobooks: '#D97706',
  files: '#737373',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  full: 9999,
};

export const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMono: "'JetBrains Mono', 'Fira Code', monospace",
  fontFamilyScript: "'Kaushan Script', cursive",
};

/**
 * Media overlay tokens — always dark regardless of theme.
 * Used on video players, photo lightboxes, poster hover states, hero backdrops.
 */
export const overlay = {
  /** Full black background (video player, lightbox) */
  bg: '#000000',
  /** Primary overlay text (controls, badges) */
  text: '#ffffff',
  /** Muted overlay text */
  textMuted: 'rgba(255, 255, 255, 0.7)',
  /** Subtle overlay text */
  textSubtle: 'rgba(255, 255, 255, 0.8)',

  /** Video control bar gradient */
  controlGradient: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
  /** Photo hover gradient (top fade for heart icon) */
  photoGradient: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.4) 0%, transparent 50%)',
  /** PhotoGrid subtle gradient */
  photoGradientSubtle: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.3) 0%, transparent 40%)',
  /** Poster hover gradient */
  posterGradient: 'linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, transparent 50%)',
  /** Hero backdrop gradient — fades into the page bg */
  heroGradient: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.7), var(--ant-color-bg-layout))',

  /** Light scrim (episode play icon, progress bar track) */
  scrimLight: 'rgba(0, 0, 0, 0.3)',
  /** Medium scrim (buttons over images) */
  scrim: 'rgba(0, 0, 0, 0.5)',
  /** Heavy scrim (video badge, play circle bg) */
  scrimHeavy: 'rgba(0, 0, 0, 0.6)',

  /** Buffer progress indicator on video player */
  buffer: 'rgba(255, 255, 255, 0.2)',

  /** Drop shadow for icons rendered over images */
  iconShadow: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5))',
  /** Stronger icon shadow (photo favorite heart) */
  iconShadowStrong: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6))',
};

/**
 * Shadow tokens — theme-aware via CSS custom properties.
 * Import from CSS vars: var(--sf-shadow-card), var(--sf-shadow-elevated)
 * Static values here are the light-mode defaults for reference.
 */
export const shadows = {
  card: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
  elevated: '0 8px 24px rgba(0, 0, 0, 0.15)',
};

/**
 * CSS custom property names — use these in inline styles as var() references.
 * Theme-aware values that differ between dark and light mode.
 */
export const cssVar = {
  accent: 'var(--sf-accent)',
  accentHover: 'var(--sf-accent-hover)',
  accentSubtle: 'var(--sf-accent-subtle)',
  avatarBg: 'var(--sf-avatar-bg)',
  shadowCard: 'var(--sf-shadow-card)',
  shadowElevated: 'var(--sf-shadow-elevated)',
  authBg: 'var(--sf-auth-bg)',
  dropzoneBg: 'var(--sf-dropzone-bg)',
  dropzoneBorder: 'var(--sf-dropzone-border)',
};
