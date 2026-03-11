import { useState, type CSSProperties } from 'react';
import { typography } from '@steadfirm/theme';

export interface WordmarkProps {
  /** Font size in pixels — defaults to 22 for header, use ~32 for auth pages */
  size?: number;
  /** Text color — defaults to currentColor (inherits from parent) */
  color?: string;
  /** Accent color for the swoosh — defaults to the theme accent var */
  accentColor?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  onClick?: () => void;
}

/** Duration of the hover animation in ms */
const HOVER_DURATION_MS = 350;
/** Slight forward lean on hover (degrees) */
const HOVER_ROTATE_DEG = -2;
/** Scale bump on hover */
const HOVER_SCALE = 1.04;

/**
 * Steadfirm script wordmark — bold cursive logo inspired by the Virgin brand.
 * Renders the brand name in Kaushan Script with an organic filled swoosh
 * underneath that slides in on hover.
 */
export function Wordmark({
  size = 22,
  color,
  accentColor = 'var(--sf-accent)',
  style,
  onClick,
}: WordmarkProps) {
  const [hovered, setHovered] = useState(false);

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
        fontWeight: 400,
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

      {/*
        Organic filled swoosh — varies in thickness like a brush stroke.
        Starts thin on the left, swells through the middle, tapers off right.
        On hover it slides in from the left and settles under the text.
      */}
      <svg
        viewBox="0 0 140 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: size * -0.06,
          left: '5%',
          width: '90%',
          height: size * 0.35,
          overflow: 'visible',
          pointerEvents: 'none',
          transform: hovered ? 'translateX(8px)' : 'translateX(-20px)',
          opacity: hovered ? 0.85 : 0.55,
          transition: [
            `transform ${HOVER_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
            `opacity ${HOVER_DURATION_MS}ms ease`,
          ].join(', '),
        }}
      >
        {/* Filled brush-stroke shape: thin entry → fat belly → thin taper */}
        <path
          d={[
            'M2 9',
            'C6 9, 10 8.5, 18 7',        // thin entry
            'C28 5, 36 3.5, 52 3',         // rises and starts to swell
            'C64 2.5, 76 2, 88 3',         // thick middle belly (top edge)
            'C100 4, 112 5, 124 5.5',      // carrying through
            'L132 6',                       // tip approach
            'Q136 6.2, 138 6.5',           // very thin taper end
            'Q136 7, 132 7.5',             // curves back (bottom edge)
            'C120 8.5, 108 9, 96 9.5',     // bottom of the swell
            'C80 10, 66 10.5, 52 10',       // fattest part underside
            'C38 9.5, 26 9, 16 9.5',       // narrows back
            'C10 10, 6 10, 2 9',           // thin exit back to start
            'Z',
          ].join(' ')}
          fill={accentColor}
        />
      </svg>
    </span>
  );
}
