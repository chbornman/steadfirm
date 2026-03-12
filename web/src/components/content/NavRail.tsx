import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cssVar } from '@steadfirm/theme';
import { RAIL_TOP, RAIL_SPRING } from './constants';

/**
 * Floating left-side sub-navigation rail.
 *
 * Renders a vertical strip of icon + label buttons. The active item is
 * highlighted with a pill background; all items always show their label.
 * Visually mirrors the FilterRail on the right side.
 *
 * Only rendered on pages with sub-navigation (Media: Movies/Shows, Reading:
 * library tabs). Pages without sub-nav simply omit this component.
 */

export interface NavRailItem {
  key: string;
  label: string;
  icon: ReactNode;
}

interface NavRailProps {
  items: NavRailItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function NavRail({ items, activeKey, onChange }: NavRailProps) {
  if (items.length < 2) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={RAIL_SPRING}
      style={{
        position: 'fixed',
        left: 12,
        top: RAIL_TOP,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background: cssVar.accent,
        border: 'none',
        boxShadow: 'var(--sf-shadow-card)',
      }}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px 8px 10px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: isActive ? '#fff' : 'rgba(255, 255, 255, 0.7)',
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'inherit',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              transition: 'color 0.15s ease',
            }}
          >
            {/* Sliding pill background */}
            {isActive && (
              <motion.span
                layoutId="nav-rail-pill"
                transition={RAIL_SPRING}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.2)',
                  zIndex: -1,
                }}
              />
            )}

            <span style={{ display: 'flex', flexShrink: 0, lineHeight: 0 }}>
              {item.icon}
            </span>

            <span>{item.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}
