import { useState } from 'react';
import { Input, Typography, Tag } from 'antd';
import { FilmSlate, CaretRight, MonitorPlay } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { SERVICE_COLORS, formatFileSize } from '@steadfirm/shared';
import type { TvShowGroup, TvEpisode } from '@steadfirm/shared';

// ─── Types ───────────────────────────────────────────────────────────

export interface TvShowGroupEditable extends TvShowGroup {
  /** User-edited series name. */
  editedSeriesName?: string;
  /** User-edited year. */
  editedYear?: string;
  /** User-edited episode titles (keyed by file index). */
  editedEpisodeTitles?: Record<number, string>;
}

export interface TvShowReviewPanelProps {
  groups: TvShowGroupEditable[];
  /** Map from file index to file info. */
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  /** Called when the user edits metadata for a group. */
  onGroupChange: (groupIndex: number, updates: Partial<TvShowGroupEditable>) => void;
}

// ─── Colors ──────────────────────────────────────────────────────────

const MEDIA_COLOR = SERVICE_COLORS.media;
const MEDIA_BG = `${MEDIA_COLOR}10`;
const MEDIA_BORDER = `${MEDIA_COLOR}40`;

// ─── Component ───────────────────────────────────────────────────────

export function TvShowReviewPanel({
  groups,
  fileNames,
  onGroupChange,
}: TvShowReviewPanelProps) {
  if (groups.length === 0) return null;

  const totalEpisodes = groups.reduce((sum, g) => sum + g.episodes.length, 0);

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
        <MonitorPlay size={20} weight="duotone" color={MEDIA_COLOR} />
        <Typography.Text strong style={{ fontSize: 14 }}>
          {groups.length} TV Show{groups.length > 1 ? 's' : ''} detected
        </Typography.Text>
        <Tag
          color={MEDIA_COLOR}
          style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
        >
          {totalEpisodes} episode{totalEpisodes !== 1 ? 's' : ''}
        </Tag>
      </div>

      {/* Show groups */}
      <div style={{ padding: 8 }}>
        {groups.map((group, groupIndex) => (
          <TvShowGroupCard
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

function TvShowGroupCard({
  group,
  fileNames,
  onChange,
  defaultExpanded,
}: {
  group: TvShowGroupEditable;
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  onChange: (updates: Partial<TvShowGroupEditable>) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const displayName = group.editedSeriesName ?? group.seriesName;
  const displayYear = group.editedYear ?? group.year ?? '';

  // Group episodes by season
  const seasonMap = new Map<number, TvEpisode[]>();
  for (const ep of group.episodes) {
    const existing = seasonMap.get(ep.season) ?? [];
    existing.push(ep);
    seasonMap.set(ep.season, existing);
  }
  const seasons = [...seasonMap.entries()].sort(([a], [b]) => a - b);

  const subtitleParts: string[] = [];
  if (displayYear) subtitleParts.push(displayYear);
  subtitleParts.push(`${seasons.length} season${seasons.length !== 1 ? 's' : ''}`);
  subtitleParts.push(`${group.episodes.length} episode${group.episodes.length !== 1 ? 's' : ''}`);
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
        <MonitorPlay size={16} weight="fill" color={MEDIA_COLOR} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName || 'Unknown Show'}
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
                    Series Name
                  </label>
                  <Input
                    size="small"
                    value={displayName}
                    onChange={(e) => onChange({ editedSeriesName: e.target.value })}
                    placeholder="Series name"
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
                    placeholder="e.g. 2008"
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
                <div>Shows/{displayName}{displayYear ? ` (${displayYear})` : ''}/</div>
                {seasons.map(([season]) => (
                  <div key={season} style={{ paddingLeft: 16 }}>
                    Season {String(season).padStart(2, '0')}/
                  </div>
                ))}
              </div>

              {/* Episode list grouped by season */}
              {seasons.map(([season, episodes]) => (
                <div key={season}>
                  <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginBottom: 4, fontWeight: 600 }}>
                    Season {season} ({episodes.length} episode{episodes.length !== 1 ? 's' : ''})
                  </div>
                  <div
                    style={{
                      borderRadius: 6,
                      border: '1px solid var(--ant-color-border)',
                      overflow: 'hidden',
                      marginBottom: 8,
                    }}
                  >
                    {episodes.map((ep, epIdx) => {
                      const fileInfo = fileNames.get(ep.fileIndex);
                      if (!fileInfo) return null;

                      return (
                        <div
                          key={ep.fileIndex}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '5px 10px',
                            borderBottom: epIdx < episodes.length - 1 ? '1px solid var(--ant-color-border-secondary)' : 'none',
                            fontSize: 12,
                          }}
                        >
                          <span style={{ color: MEDIA_COLOR, fontWeight: 600, width: 50, fontSize: 11, flexShrink: 0 }}>
                            S{String(ep.season).padStart(2, '0')}E{String(ep.episode).padStart(2, '0')}
                            {ep.episodeEnd ? `-E${String(ep.episodeEnd).padStart(2, '0')}` : ''}
                          </span>
                          <FilmSlate size={12} color="var(--ant-color-text-tertiary)" />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ep.title ?? fileInfo.name}
                          </span>
                          <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 10, flexShrink: 0 }}>
                            {formatFileSize(fileInfo.size)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
