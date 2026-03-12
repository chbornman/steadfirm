import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Spin, Grid } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CONTENT_PADDING_DESKTOP,
  CONTENT_PADDING_MOBILE,
  CONTENT_MAX_WIDTH,
} from './constants';

const { useBreakpoint } = Grid;

/**
 * Shared content page wrapper.
 *
 * Provides consistent structure for all content pages:
 * - Horizontal padding (48px desktop, 16px mobile)
 * - Infinite scroll sentinel + animated loading spinner
 * - Slots for hero sections (Continue Listening/Reading)
 * - Floating NavRail and FilterRail are rendered as children by the page
 *   (they position themselves via `position: fixed`)
 *
 * The rails float over the content and do not affect document flow.
 */

interface ContentPageProps {
  children: ReactNode;
  /** Ref for the infinite scroll sentinel element */
  sentinelRef: RefObject<HTMLDivElement | null>;
  /** Whether the next page of infinite scroll is loading */
  isFetchingNextPage: boolean;
  /** Optional hero section rendered above the main content at full bleed */
  hero?: ReactNode;
  /** Optional nav rail (floating, renders itself fixed) */
  navRail?: ReactNode;
  /** Optional filter rail (floating, renders itself fixed) */
  filterRail?: ReactNode;
  /** Override min-height for the content area */
  minHeight?: string;
}

export function ContentPage({
  children,
  sentinelRef,
  isFetchingNextPage,
  hero,
  navRail,
  filterRail,
  minHeight = 'calc(100vh - 120px)',
}: ContentPageProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const horizontalPadding = isMobile ? CONTENT_PADDING_MOBILE : CONTENT_PADDING_DESKTOP;

  const containerStyle: CSSProperties = isMobile ? {} : {
    maxWidth: CONTENT_MAX_WIDTH,
    marginLeft: 'auto',
    marginRight: 'auto',
  };

  return (
    <>
      {/* Floating rails — position: fixed, outside document flow */}
      {!isMobile && navRail}
      {!isMobile && filterRail}

      {/* Hero section */}
      {hero && (
        <div style={{ ...containerStyle, padding: `0 ${horizontalPadding}px` }}>
          {hero}
        </div>
      )}

      {/* Main content area */}
      <div
        style={{
          ...containerStyle,
          padding: `0 ${horizontalPadding}px`,
          minHeight,
        }}
      >
        {children}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {/* Loading indicator for next page */}
      <AnimatePresence>
        {isFetchingNextPage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'flex', justifyContent: 'center', padding: 24 }}
          >
            <Spin />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
