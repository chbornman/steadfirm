import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cssVar } from '@steadfirm/theme';
import { RAIL_COLLAPSED_WIDTH, RAIL_TOP, RAIL_SPRING } from './constants';

/**
 * Floating left-side sub-navigation rail.
 *
 * Renders a vertical strip of icon buttons. The active item expands to show
 * its label; inactive items show only their icon. Visually mirrors the
 * FilterRail on the right side.
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
        background: 'var(--ant-color-bg-container)',
        border: '1px solid var(--ant-color-border)',
        boxShadow: 'var(--sf-shadow-card)',
      }}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <motion.button
            key={item.key}
            layout
            onClick={() => onChange(item.key)}
            transition={RAIL_SPRING}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: isActive ? 8 : 0,
              padding: isActive ? '8px 14px 8px 10px' : '8px',
              width: isActive ? 'auto' : RAIL_COLLAPSED_WIDTH,
              minWidth: RAIL_COLLAPSED_WIDTH,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: isActive ? '#fff' : 'var(--ant-color-text-secondary)',
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'inherit',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {/* Active pill background */}
            <AnimatePresence>
              {isActive && (
                <motion.span
                  layoutId="nav-rail-pill"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={RAIL_SPRING}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 8,
                    background: cssVar.accent,
                    zIndex: -1,
                  }}
                />
              )}
            </AnimatePresence>

            <motion.span
              layout="position"
              style={{ display: 'flex', flexShrink: 0, lineHeight: 0 }}
            >
              {item.icon}
            </motion.span>

            <AnimatePresence initial={false}>
              {isActive && (
                <motion.span
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ ...RAIL_SPRING, opacity: { duration: 0.12 } }}
                  style={{ overflow: 'hidden', display: 'inline-block' }}
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
