import { useState, type CSSProperties } from 'react';
import { typography } from '@steadfirm/theme';

export interface WordmarkProps {
  /** Font size in pixels — defaults to 22 for header, use ~32 for auth pages */
  size?: number;
  /** Text color — defaults to currentColor (inherits from parent) */
  color?: string;
  /** Accent color for the underline swoosh — defaults to the theme accent var */
  accentColor?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  onClick?: () => void;
}

/** Duration of the hover tilt animation in ms */
const HOVER_DURATION_MS = 300;
/** Slight forward lean on hover (degrees) */
const HOVER_ROTATE_DEG = -2;
/** Scale bump on hover */
const HOVER_SCALE = 1.04;

/**
 * Steadfirm script wordmark — bold cursive logo inspired by the Virgin brand.
 * Renders the brand name in Kaushan Script with a decorative accent swoosh
 * and a playful hover tilt animation.
 */
export function Wordmark({
  size = 22,
  color,
  accentColor = 'var(--sf-accent)',
  style,
  onClick,
}: WordmarkProps) {
  const [hovered, setHovered] = useState(false);

  /** Swoosh sits just below the text baseline */
  const swooshHeight = Math.max(size * 0.12, 2);
  const swooshOffset = size * 0.08;

  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: typography.fontFamilyScript,
        fontSize: size,
        fontWeight: 400, // Kaushan Script only has 400 but looks bold naturally
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
        color: color ?? 'currentColor',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        transition: `transform ${HOVER_DURATION_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
        transform: hovered
          ? `rotate(${HOVER_ROTATE_DEG}deg) scale(${HOVER_SCALE})`
          : 'rotate(0deg) scale(1)',
        transformOrigin: 'left center',
        ...style,
      }}
    >
      Steadfirm

      {/* Decorative accent swoosh underline */}
      <svg
        viewBox="0 0 120 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'absolute',
          bottom: -swooshOffset,
          left: '5%',
          width: '95%',
          height: swooshHeight + 4,
          overflow: 'visible',
          opacity: hovered ? 1 : 0.7,
          transition: `opacity ${HOVER_DURATION_MS}ms ease`,
        }}
      >
        <path
          d="M2 8 C20 2, 40 2, 60 6 S100 10, 118 4"
          stroke={accentColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          style={{
            strokeDasharray: 140,
            strokeDashoffset: hovered ? 0 : 140,
            transition: `stroke-dash-offset ${HOVER_DURATION_MS + 200}ms cubic-bezier(0.65, 0, 0.35, 1)`,
          }}
        />
      </svg>
    </span>
  );
}
