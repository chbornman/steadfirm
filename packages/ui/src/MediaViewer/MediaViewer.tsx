import { useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { overlay, duration, ease } from '@steadfirm/theme';

/** Z-index for the media viewer overlay — above everything else */
const VIEWER_Z_INDEX = 1100;

/** Backdrop opacity for the media viewer scrim */
const BACKDROP_OPACITY = 0.85;

export interface MediaViewerProps {
  /** Whether the viewer is open */
  open: boolean;
  /** Called when the viewer should close (Escape, backdrop click, close button) */
  onClose: () => void;
  /** Content to render inside the viewer */
  children: ReactNode;
  /**
   * Maximum width of the content area.
   * @default '90vw'
   */
  maxWidth?: string | number;
  /**
   * Maximum height of the content area.
   * @default '90vh'
   */
  maxHeight?: string | number;
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.normal } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: ease.spring,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: duration.fast },
  },
};

export function MediaViewer({
  open,
  onClose,
  children,
  maxWidth = '90vw',
  maxHeight = '90vh',
}: MediaViewerProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [open, handleKeyDown]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="media-viewer-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: VIEWER_Z_INDEX,
            background: `rgba(0, 0, 0, ${BACKDROP_OPACITY})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              position: 'fixed',
              top: 16,
              right: 16,
              zIndex: VIEWER_Z_INDEX + 1,
              background: overlay.scrim,
              border: 'none',
              borderRadius: 8,
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: overlay.text,
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = overlay.scrimHeavy;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = overlay.scrim;
            }}
          >
            <X size={20} weight="bold" />
          </button>

          {/* Content container */}
          <motion.div
            variants={contentVariants}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth,
              maxHeight,
              width: '100%',
              height: '100%',
              display: 'flex',
              borderRadius: 12,
              overflow: 'hidden',
              background: 'var(--ant-color-bg-container)',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
