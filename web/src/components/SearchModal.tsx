import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Modal, Empty, Spin, Typography } from 'antd';
import {
  ImagesSquare,
  FilmSlate,
  FileText,
  Headphones,
  BookOpenText,
  Folder,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { SERVICE_LABELS } from '@steadfirm/shared';
import type { ServiceName, SearchResultItem } from '@steadfirm/shared';
import { useSearch } from '@/hooks/useSearch';

const { Text } = Typography;

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

const SERVICE_ICONS: Record<ServiceName, React.ComponentType<{ size: number }>> = {
  photos: ImagesSquare,
  media: FilmSlate,
  documents: FileText,
  audiobooks: Headphones,
  reading: BookOpenText,
  files: Folder,
};

const SERVICE_ICON_COLORS: Record<ServiceName, string> = {
  photos: '#3B82F6',
  media: '#8B5CF6',
  documents: '#22C55E',
  audiobooks: '#D97706',
  reading: '#EC4899',
  files: '#737373',
};

export function SearchModal({ open, onClose }: SearchModalProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { phase, allResults, complete, error, search, reset } = useSearch();

  // Focus input when modal opens.
  useEffect(() => {
    if (open) {
      // Small delay so the modal animation completes first.
      const t = setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>('.sf-search-input');
        el?.focus();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setQuery('');
      reset();
    }
  }, [open, reset]);

  // Debounced search.
  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (value.trim().length < 2) {
        reset();
        return;
      }
      debounceRef.current = setTimeout(() => {
        void search(value.trim());
      }, 300);
    },
    [search, reset],
  );

  const handleResultClick = useCallback(
    (item: SearchResultItem) => {
      onClose();
      void navigate({ to: item.route });
    },
    [navigate, onClose],
  );

  // Keyboard shortcut: Escape closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const hasResults = allResults.length > 0;
  const totalItems = allResults.reduce((sum, r) => sum + r.items.length, 0);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      styles={{
        body: { padding: 0 },
        content: { borderRadius: 12, overflow: 'hidden' },
      }}
      style={{ top: 80 }}
    >
      {/* Search input */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--ant-color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <MagnifyingGlass size={20} style={{ color: 'var(--ant-color-text-tertiary)', flexShrink: 0 }} />
        <input
          className="sf-search-input"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search everything..."
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 16,
            color: 'var(--ant-color-text)',
            fontFamily: 'inherit',
          }}
        />
        {phase === 'searching' && <Spin size="small" />}
        <kbd
          style={{
            padding: '2px 6px',
            borderRadius: 4,
            border: '1px solid var(--ant-color-border)',
            fontSize: 11,
            color: 'var(--ant-color-text-tertiary)',
            lineHeight: '18px',
          }}
        >
          ESC
        </kbd>
      </div>

      {/* Results */}
      <div
        style={{
          maxHeight: 420,
          overflowY: 'auto',
          padding: hasResults || phase === 'searching' ? '8px 0' : 0,
        }}
      >
        {/* Empty states */}
        {phase === 'idle' && query.length < 2 && (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <Text type="secondary">Type to search across all your content</Text>
          </div>
        )}

        {phase === 'done' && !hasResults && (
          <div style={{ padding: '24px 16px' }}>
            <Empty
              description={`No results for "${query}"`}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        )}

        {phase === 'error' && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <Text type="danger">{error || 'Search failed'}</Text>
          </div>
        )}

        {/* Grouped results */}
        {allResults.map((serviceResult) => {
          if (serviceResult.items.length === 0) return null;
          const Icon = SERVICE_ICONS[serviceResult.service];
          const iconColor = SERVICE_ICON_COLORS[serviceResult.service];
          const label = SERVICE_LABELS[serviceResult.service];

          return (
            <div key={serviceResult.service}>
              {/* Section header */}
              <div
                style={{
                  padding: '6px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--ant-color-text-tertiary)',
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                <Icon size={14} />
                {label}
                {serviceResult.total > serviceResult.items.length && (
                  <span style={{ fontWeight: 400 }}>
                    ({serviceResult.total} total)
                  </span>
                )}
              </div>

              {/* Items */}
              {serviceResult.items.map((item) => (
                <button
                  key={`${serviceResult.service}-${item.id}`}
                  onClick={() => handleResultClick(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    padding: '8px 16px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--ant-color-fill-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {/* Thumbnail */}
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 6,
                        objectFit: 'cover',
                        flexShrink: 0,
                        background: 'var(--ant-color-fill-quaternary)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 6,
                        background: 'var(--ant-color-fill-quaternary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: iconColor,
                      }}
                    >
                      <Icon size={20} />
                    </div>
                  )}

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: 'var(--ant-color-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--ant-color-text-tertiary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Footer with timing info */}
      {phase === 'done' && hasResults && complete && (
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--ant-color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--ant-color-text-quaternary)',
          }}
        >
          <span>{totalItems} results</span>
          <span>{complete.durationMs}ms</span>
        </div>
      )}
    </Modal>
  );
}
