import { useState } from 'react';
import { Input, Typography, Tag } from 'antd';
import { BookOpen, CaretRight, Book } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { SERVICE_COLORS, formatFileSize } from '@steadfirm/shared';
import type { ReadingGroup } from '@steadfirm/shared';

// ─── Types ───────────────────────────────────────────────────────────

export interface ReadingGroupEditable extends ReadingGroup {
  /** User-edited series name. */
  editedSeriesName?: string;
}

export interface ReadingReviewPanelProps {
  groups: ReadingGroupEditable[];
  /** Map from file index to file info. */
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  /** Called when the user edits metadata for a group. */
  onGroupChange: (groupIndex: number, updates: Partial<ReadingGroupEditable>) => void;
}

// ─── Colors ──────────────────────────────────────────────────────────

const READING_COLOR = SERVICE_COLORS.reading;
const READING_BG = `${READING_COLOR}10`;
const READING_BORDER = `${READING_COLOR}40`;

// Format labels for file types
const FORMAT_LABELS: Record<string, string> = {
  epub: 'EPUB',
  mobi: 'MOBI',
  azw: 'AZW',
  azw3: 'AZW3',
  fb2: 'FB2',
  cbz: 'CBZ',
  cbr: 'CBR',
  cb7: 'CB7',
  pdf: 'PDF',
};

// ─── Component ───────────────────────────────────────────────────────

export function ReadingReviewPanel({
  groups,
  fileNames,
  onGroupChange,
}: ReadingReviewPanelProps) {
  if (groups.length === 0) return null;

  const totalVolumes = groups.reduce((sum, g) => sum + g.volumes.length, 0);

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${READING_BORDER}`,
        overflow: 'hidden',
        marginBottom: 16,
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: READING_BG,
          borderBottom: `1px solid ${READING_BORDER}`,
        }}
      >
        <BookOpen size={20} weight="duotone" color={READING_COLOR} />
        <Typography.Text strong style={{ fontSize: 14 }}>
          {groups.length} Series detected
        </Typography.Text>
        <Tag
          color={READING_COLOR}
          style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
        >
          {totalVolumes} volume{totalVolumes !== 1 ? 's' : ''}
        </Tag>
      </div>

      {/* Reading groups */}
      <div style={{ padding: 8 }}>
        {groups.map((group, groupIndex) => (
          <ReadingGroupCard
            key={groupIndex}
            group={group}
            fileNames={fileNames}
            onChange={(updates) => onGroupChange(groupIndex, updates)}
            defaultExpanded={groups.length === 1}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Group Card ──────────────────────────────────────────────────────

function ReadingGroupCard({
  group,
  fileNames,
  onChange,
  defaultExpanded,
}: {
  group: ReadingGroupEditable;
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  onChange: (updates: Partial<ReadingGroupEditable>) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const displayName = group.editedSeriesName ?? group.seriesName;
  const volumeCount = group.volumes.length;
  const specialCount = group.volumes.filter((v) => v.isSpecial).length;

  // Get formats summary
  const formats = new Set(group.volumes.map((v) => v.format));
  const formatStr = [...formats].map((f) => FORMAT_LABELS[f] ?? f.toUpperCase()).join(', ');

  const subtitleParts: string[] = [];
  subtitleParts.push(`${volumeCount} volume${volumeCount !== 1 ? 's' : ''}`);
  if (specialCount > 0) {
    subtitleParts.push(`${specialCount} special${specialCount !== 1 ? 's' : ''}`);
  }
  subtitleParts.push(formatStr);

  return (
    <div
      style={{
        borderRadius: 8,
        border: '1px solid var(--ant-color-border)',
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      {/* Card header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'var(--ant-color-bg-container)',
        }}
      >
        <BookOpen size={16} weight="fill" color={READING_COLOR} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName || 'Unknown Series'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginTop: 1 }}>
            {subtitleParts.join(' \u00B7 ')}
          </div>
        </div>
        <CaretRight
          size={12}
          weight="bold"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            color: 'var(--ant-color-text-tertiary)',
          }}
        />
      </div>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div style={{ padding: '8px 14px 14px', borderTop: '1px solid var(--ant-color-border)' }}>
              {/* Essential fields */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Series Name
                  </label>
                  <Input
                    size="small"
                    value={displayName}
                    onChange={(e) => onChange({ editedSeriesName: e.target.value })}
                    placeholder="Series name"
                  />
                </div>
              </div>

              {/* Folder structure preview */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--ant-color-bg-layout)',
                  marginBottom: 12,
                  fontSize: 11,
                  color: 'var(--ant-color-text-secondary)',
                  fontFamily: 'monospace',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4, fontFamily: 'inherit' }}>
                  Kavita folder structure:
                </div>
                <div>{displayName}/</div>
                {group.volumes.slice(0, 5).map((vol) => {
                  const fileInfo = fileNames.get(vol.fileIndex);
                  return (
                    <div key={vol.fileIndex} style={{ paddingLeft: 16 }}>
                      {fileInfo?.name ?? `volume.${vol.format}`}
                    </div>
                  );
                })}
                {group.volumes.length > 5 && (
                  <div style={{ paddingLeft: 16, fontStyle: 'italic' }}>
                    ... and {group.volumes.length - 5} more
                  </div>
                )}
              </div>

              {/* Volume list */}
              <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginBottom: 4, fontWeight: 600 }}>
                Volumes ({volumeCount})
              </div>
              <div
                style={{
                  borderRadius: 6,
                  border: '1px solid var(--ant-color-border)',
                  overflow: 'hidden',
                }}
              >
                {group.volumes.map((vol, volIdx) => {
                  const fileInfo = fileNames.get(vol.fileIndex);
                  if (!fileInfo) return null;

                  return (
                    <div
                      key={vol.fileIndex}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 10px',
                        borderBottom: volIdx < volumeCount - 1 ? '1px solid var(--ant-color-border-secondary)' : 'none',
                        fontSize: 12,
                      }}
                    >
                      {vol.number ? (
                        <span style={{ color: READING_COLOR, fontWeight: 600, width: 32, fontSize: 11, flexShrink: 0, textAlign: 'right' }}>
                          v{vol.number}
                        </span>
                      ) : (
                        <span style={{ width: 32, flexShrink: 0 }} />
                      )}
                      <Book size={12} color="var(--ant-color-text-tertiary)" />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {vol.title ?? fileInfo.name}
                      </span>
                      <Tag style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 3px' }}>
                        {FORMAT_LABELS[vol.format] ?? vol.format.toUpperCase()}
                      </Tag>
                      {vol.isSpecial && (
                        <Tag color="gold" style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 3px' }}>
                          SP
                        </Tag>
                      )}
                      <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 10 }}>
                        {formatFileSize(fileInfo.size)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
