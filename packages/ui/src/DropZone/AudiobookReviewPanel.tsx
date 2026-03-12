import { useCallback, useState } from 'react';
import { Button, Input, Typography, Tag, Collapse, Tooltip } from 'antd';
import {
  Headphones,
  CaretRight,
  DotsSixVertical,
  MusicNote,
  Image,
  PencilSimple,
  Eye,
  SlidersHorizontal,
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { SERVICE_COLORS, formatFileSize, formatDuration } from '@steadfirm/shared';
import type { AudiobookGroup, AudiobookProbeData } from '@steadfirm/shared';

// ─── Types ───────────────────────────────────────────────────────────

export interface AudiobookGroupEditable extends AudiobookGroup {
  /** User-edited title (overrides inferred). */
  editedTitle?: string;
  /** User-edited author. */
  editedAuthor?: string;
  /** User-edited series. */
  editedSeries?: string;
  /** User-edited series sequence. */
  editedSeriesSequence?: string;
  /** User-edited narrator. */
  editedNarrator?: string;
  /** User-edited year. */
  editedYear?: string;
}

export interface AudiobookReviewPanelProps {
  groups: AudiobookGroupEditable[];
  /** Map from file index to DroppedFile for display. */
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  /** Called when the user edits metadata for a group. */
  onGroupChange: (groupIndex: number, updates: Partial<AudiobookGroupEditable>) => void;
  /** Called when the user reorders tracks within a group. */
  onReorderTracks?: (groupIndex: number, newFileIndices: number[]) => void;
  /** Whether probe data is currently loading. */
  isProbing?: boolean;
}

// ─── Colors & constants ──────────────────────────────────────────────

const AUDIOBOOK_COLOR = SERVICE_COLORS.audiobooks;
const AUDIOBOOK_BG = `${AUDIOBOOK_COLOR}10`;
const AUDIOBOOK_BORDER = `${AUDIOBOOK_COLOR}40`;

// ─── Component ───────────────────────────────────────────────────────

export function AudiobookReviewPanel({
  groups,
  fileNames,
  onGroupChange,
  onReorderTracks: _onReorderTracks,
  isProbing,
}: AudiobookReviewPanelProps) {
  if (groups.length === 0) return null;

  const totalFiles = groups.reduce((sum, g) => sum + g.fileIndices.length, 0);
  const totalDuration = groups.reduce(
    (sum, g) => sum + (g.probeData?.totalDurationSecs ?? 0),
    0,
  );

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${AUDIOBOOK_BORDER}`,
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
          background: AUDIOBOOK_BG,
          borderBottom: `1px solid ${AUDIOBOOK_BORDER}`,
        }}
      >
        <Headphones size={20} weight="duotone" color={AUDIOBOOK_COLOR} />
        <Typography.Text strong style={{ fontSize: 14 }}>
          {groups.length} Audiobook{groups.length > 1 ? 's' : ''} detected
        </Typography.Text>
        <Tag
          color={AUDIOBOOK_COLOR}
          style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
        >
          {totalFiles} file{totalFiles !== 1 ? 's' : ''}
        </Tag>
        {totalDuration > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {formatDuration(totalDuration)} total
          </Typography.Text>
        )}
        {isProbing && (
          <Typography.Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
            Reading metadata...
          </Typography.Text>
        )}
      </div>

      {/* Audiobook groups */}
      <div style={{ padding: 8 }}>
        {groups.map((group, groupIndex) => (
          <AudiobookGroupCard
            key={groupIndex}
            group={group}
            groupIndex={groupIndex}
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

function AudiobookGroupCard({
  group,
  groupIndex,
  fileNames,
  onChange,
  defaultExpanded,
}: {
  group: AudiobookGroupEditable;
  groupIndex: number;
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  onChange: (updates: Partial<AudiobookGroupEditable>) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const displayTitle = group.editedTitle ?? group.title;
  const displayAuthor = group.editedAuthor ?? group.author ?? '';
  const displaySeries = group.editedSeries ?? group.series ?? '';
  const displaySequence = group.editedSeriesSequence ?? group.seriesSequence ?? '';
  const displayNarrator = group.editedNarrator ?? group.narrator ?? '';
  const displayYear = group.editedYear ?? group.year ?? '';

  // Use probe data for enriched display
  const probe = group.probeData;
  const duration = probe?.totalDurationSecs ?? 0;
  const trackCount = group.fileIndices.length;

  // Subtitle line
  const subtitleParts: string[] = [];
  if (displayAuthor) subtitleParts.push(displayAuthor);
  if (displaySeries) {
    subtitleParts.push(
      displaySequence ? `${displaySeries} #${displaySequence}` : displaySeries,
    );
  }
  if (duration > 0) subtitleParts.push(formatDuration(duration));
  subtitleParts.push(`${trackCount} file${trackCount !== 1 ? 's' : ''}`);

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
        <Headphones size={16} weight="fill" color={AUDIOBOOK_COLOR} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayTitle || 'Untitled Audiobook'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginTop: 1 }}>
            {subtitleParts.join(' \u00B7 ')}
          </div>
        </div>

        {/* Probe enrichment badges */}
        {probe && (
          <div style={{ display: 'flex', gap: 4 }}>
            {probe.artist && !displayAuthor && (
              <Tooltip title={`ID3 artist: ${probe.artist}`}>
                <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                  ID3
                </Tag>
              </Tooltip>
            )}
          </div>
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
              {/* Essential fields (always visible) */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Title
                  </label>
                  <Input
                    size="small"
                    value={displayTitle}
                    onChange={(e) => onChange({ editedTitle: e.target.value })}
                    placeholder="Book title"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Author
                  </label>
                  <Input
                    size="small"
                    value={displayAuthor}
                    onChange={(e) => onChange({ editedAuthor: e.target.value })}
                    placeholder="Author name"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Series
                  </label>
                  <Input
                    size="small"
                    value={displaySeries}
                    onChange={(e) => onChange({ editedSeries: e.target.value })}
                    placeholder="Series name (optional)"
                  />
                </div>
              </div>

              {/* Advanced toggle */}
              <div style={{ marginBottom: 8 }}>
                <Button
                  type="text"
                  size="small"
                  icon={<SlidersHorizontal size={12} />}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', padding: '0 4px' }}
                >
                  {showAdvanced ? 'Hide advanced' : 'Show advanced'}
                </Button>
              </div>

              {/* Advanced fields */}
              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                          Series #
                        </label>
                        <Input
                          size="small"
                          value={displaySequence}
                          onChange={(e) => onChange({ editedSeriesSequence: e.target.value })}
                          placeholder="e.g. 1"
                          style={{ width: 80 }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                          Narrator
                        </label>
                        <Input
                          size="small"
                          value={displayNarrator}
                          onChange={(e) => onChange({ editedNarrator: e.target.value })}
                          placeholder="Narrator name"
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
                          placeholder="e.g. 2006"
                        />
                      </div>
                    </div>

                    {/* Probe data display */}
                    {probe && (
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: 'var(--ant-color-bg-layout)',
                          marginBottom: 8,
                          fontSize: 11,
                          color: 'var(--ant-color-text-secondary)',
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>ID3 Metadata (from audio files)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
                          {probe.album && <><span>Album:</span><span>{probe.album}</span></>}
                          {probe.artist && <><span>Artist:</span><span>{probe.artist}</span></>}
                          {probe.composer && <><span>Composer/Narrator:</span><span>{probe.composer}</span></>}
                          {probe.genre && <><span>Genre:</span><span>{probe.genre}</span></>}
                          {probe.year && <><span>Year:</span><span>{probe.year}</span></>}
                          {probe.series && <><span>Series:</span><span>{probe.series}</span></>}
                          {probe.seriesPart && <><span>Series Part:</span><span>{probe.seriesPart}</span></>}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* File list / track order */}
              <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginBottom: 4, fontWeight: 600 }}>
                Tracks ({trackCount})
              </div>
              <div
                style={{
                  borderRadius: 6,
                  border: '1px solid var(--ant-color-border)',
                  overflow: 'hidden',
                }}
              >
                {group.fileIndices.map((fileIdx, trackIdx) => {
                  const fileInfo = fileNames.get(fileIdx);
                  const trackProbe = probe?.tracks.find((t) => t.fileIndex === fileIdx);
                  if (!fileInfo) return null;

                  return (
                    <div
                      key={fileIdx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 10px',
                        borderBottom: trackIdx < trackCount - 1 ? '1px solid var(--ant-color-border-secondary)' : 'none',
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: 'var(--ant-color-text-tertiary)', width: 20, textAlign: 'right', fontSize: 11 }}>
                        {trackProbe?.trackNumber ?? trackIdx + 1}
                      </span>
                      <MusicNote size={12} color="var(--ant-color-text-tertiary)" />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {trackProbe?.title ?? fileInfo.name}
                      </span>
                      {trackProbe && trackProbe.durationSecs > 0 && (
                        <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
                          {formatDuration(trackProbe.durationSecs)}
                        </span>
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
