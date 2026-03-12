import { useState } from 'react';
import { Input, Typography, Tag } from 'antd';
import { FilmSlate, CaretRight, FilmReel } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { SERVICE_COLORS, formatFileSize } from '@steadfirm/shared';
import type { MovieGroup } from '@steadfirm/shared';

// ─── Types ───────────────────────────────────────────────────────────

export interface MovieGroupEditable extends MovieGroup {
  /** User-edited title. */
  editedTitle?: string;
  /** User-edited year. */
  editedYear?: string;
}

export interface MovieReviewPanelProps {
  groups: MovieGroupEditable[];
  /** Map from file index to file info. */
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  /** Called when the user edits metadata for a group. */
  onGroupChange: (groupIndex: number, updates: Partial<MovieGroupEditable>) => void;
}

// ─── Colors ──────────────────────────────────────────────────────────

const MEDIA_COLOR = SERVICE_COLORS.media;
const MEDIA_BG = `${MEDIA_COLOR}10`;
const MEDIA_BORDER = `${MEDIA_COLOR}40`;

// ─── Component ───────────────────────────────────────────────────────

export function MovieReviewPanel({
  groups,
  fileNames,
  onGroupChange,
}: MovieReviewPanelProps) {
  if (groups.length === 0) return null;

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${MEDIA_BORDER}`,
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
          background: MEDIA_BG,
          borderBottom: `1px solid ${MEDIA_BORDER}`,
        }}
      >
        <FilmReel size={20} weight="duotone" color={MEDIA_COLOR} />
        <Typography.Text strong style={{ fontSize: 14 }}>
          {groups.length} Movie{groups.length > 1 ? 's' : ''} detected
        </Typography.Text>
      </div>

      {/* Movie groups */}
      <div style={{ padding: 8 }}>
        {groups.map((group, groupIndex) => (
          <MovieGroupCard
            key={groupIndex}
            group={group}
            fileNames={fileNames}
            onChange={(updates) => onGroupChange(groupIndex, updates)}
            defaultExpanded={groups.length <= 3}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Group Card ──────────────────────────────────────────────────────

function MovieGroupCard({
  group,
  fileNames,
  onChange,
  defaultExpanded,
}: {
  group: MovieGroupEditable;
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  onChange: (updates: Partial<MovieGroupEditable>) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const displayTitle = group.editedTitle ?? group.title;
  const displayYear = group.editedYear ?? group.year ?? '';
  const fileInfo = fileNames.get(group.fileIndex);

  const subtitleParts: string[] = [];
  if (displayYear) subtitleParts.push(displayYear);
  if (group.resolution) subtitleParts.push(group.resolution);
  if (group.source) subtitleParts.push(group.source);
  if (fileInfo) subtitleParts.push(formatFileSize(fileInfo.size));
  if (group.subtitleIndices && group.subtitleIndices.length > 0) {
    subtitleParts.push(`${group.subtitleIndices.length} subtitle${group.subtitleIndices.length !== 1 ? 's' : ''}`);
  }

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
        <FilmReel size={16} weight="fill" color={MEDIA_COLOR} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayTitle || 'Unknown Movie'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginTop: 1 }}>
            {subtitleParts.join(' \u00B7 ')}
          </div>
        </div>
        {group.resolution && (
          <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
            {group.resolution}
          </Tag>
        )}
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
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '8px 14px 14px', borderTop: '1px solid var(--ant-color-border)' }}>
              {/* Essential fields */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Title
                  </label>
                  <Input
                    size="small"
                    value={displayTitle}
                    onChange={(e) => onChange({ editedTitle: e.target.value })}
                    placeholder="Movie title"
                  />
                </div>
                <div style={{ width: 100 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Year
                  </label>
                  <Input
                    size="small"
                    value={displayYear}
                    onChange={(e) => onChange({ editedYear: e.target.value })}
                    placeholder="e.g. 1999"
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
                  Jellyfin folder structure:
                </div>
                <div>Movies/{displayTitle}{displayYear ? ` (${displayYear})` : ''}/</div>
                {fileInfo && (
                  <div style={{ paddingLeft: 16 }}>
                    {displayTitle}{displayYear ? ` (${displayYear})` : ''}.{fileInfo.name.split('.').pop()}
                  </div>
                )}
              </div>

              {/* File list */}
              <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginBottom: 4, fontWeight: 600 }}>
                Files
              </div>
              <div
                style={{
                  borderRadius: 6,
                  border: '1px solid var(--ant-color-border)',
                  overflow: 'hidden',
                }}
              >
                {/* Main video file */}
                {fileInfo && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 10px',
                      fontSize: 12,
                      borderBottom: (group.subtitleIndices?.length ?? 0) > 0 ? '1px solid var(--ant-color-border-secondary)' : 'none',
                    }}
                  >
                    <FilmSlate size={12} color={MEDIA_COLOR} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fileInfo.name}
                    </span>
                    <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 10 }}>
                      {formatFileSize(fileInfo.size)}
                    </span>
                  </div>
                )}

                {/* Subtitles */}
                {group.subtitleIndices?.map((idx) => {
                  const subInfo = fileNames.get(idx);
                  if (!subInfo) return null;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 10px',
                        fontSize: 12,
                      }}
                    >
                      <Tag style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 3px' }}>SUB</Tag>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {subInfo.name}
                      </span>
                      <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 10 }}>
                        {formatFileSize(subInfo.size)}
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
