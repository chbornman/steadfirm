import { useState } from 'react';
import { Input, Typography, Tag } from 'antd';
import { MusicNote, CaretRight, VinylRecord } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { SERVICE_COLORS, formatFileSize, formatDuration } from '@steadfirm/shared';
import type { MusicAlbumGroup } from '@steadfirm/shared';

// ─── Types ───────────────────────────────────────────────────────────

export interface MusicAlbumGroupEditable extends MusicAlbumGroup {
  /** User-edited album name. */
  editedAlbum?: string;
  /** User-edited artist name. */
  editedArtist?: string;
  /** User-edited year. */
  editedYear?: string;
}

export interface MusicReviewPanelProps {
  groups: MusicAlbumGroupEditable[];
  /** Map from file index to file info. */
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  /** Called when the user edits metadata for a group. */
  onGroupChange: (groupIndex: number, updates: Partial<MusicAlbumGroupEditable>) => void;
  /** Whether probe data is currently loading. */
  isProbing?: boolean;
}

// ─── Colors ──────────────────────────────────────────────────────────

const MEDIA_COLOR = SERVICE_COLORS.media;
const MEDIA_BG = `${MEDIA_COLOR}10`;
const MEDIA_BORDER = `${MEDIA_COLOR}40`;

// ─── Component ───────────────────────────────────────────────────────

export function MusicReviewPanel({
  groups,
  fileNames,
  onGroupChange,
  isProbing,
}: MusicReviewPanelProps) {
  if (groups.length === 0) return null;

  const totalTracks = groups.reduce((sum, g) => sum + g.fileIndices.length, 0);
  const totalDuration = groups.reduce(
    (sum, g) => sum + (g.probeData?.totalDurationSecs ?? 0),
    0,
  );

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
        <VinylRecord size={20} weight="duotone" color={MEDIA_COLOR} />
        <Typography.Text strong style={{ fontSize: 14 }}>
          {groups.length} Album{groups.length > 1 ? 's' : ''} detected
        </Typography.Text>
        <Tag
          color={MEDIA_COLOR}
          style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
        >
          {totalTracks} track{totalTracks !== 1 ? 's' : ''}
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

      {/* Album groups */}
      <div style={{ padding: 8 }}>
        {groups.map((group, groupIndex) => (
          <MusicAlbumCard
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

// ─── Album Card ──────────────────────────────────────────────────────

function MusicAlbumCard({
  group,
  fileNames,
  onChange,
  defaultExpanded,
}: {
  group: MusicAlbumGroupEditable;
  fileNames: Map<number, { name: string; size: number; relativePath?: string }>;
  onChange: (updates: Partial<MusicAlbumGroupEditable>) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const displayAlbum = group.editedAlbum ?? group.album;
  const displayArtist = group.editedArtist ?? group.artist ?? '';
  const displayYear = group.editedYear ?? group.year ?? '';

  const probe = group.probeData;
  const duration = probe?.totalDurationSecs ?? 0;
  const trackCount = group.fileIndices.length;

  const subtitleParts: string[] = [];
  if (displayArtist) subtitleParts.push(displayArtist);
  if (displayYear) subtitleParts.push(displayYear);
  if (duration > 0) subtitleParts.push(formatDuration(duration));
  subtitleParts.push(`${trackCount} track${trackCount !== 1 ? 's' : ''}`);

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
        <VinylRecord size={16} weight="fill" color={MEDIA_COLOR} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayAlbum || 'Unknown Album'}
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
              <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Album
                  </label>
                  <Input
                    size="small"
                    value={displayAlbum}
                    onChange={(e) => onChange({ editedAlbum: e.target.value })}
                    placeholder="Album name"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', display: 'block', marginBottom: 2 }}>
                    Artist
                  </label>
                  <Input
                    size="small"
                    value={displayArtist}
                    onChange={(e) => onChange({ editedArtist: e.target.value })}
                    placeholder="Artist name"
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
                    placeholder="e.g. 2019"
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
                <div>Music/{displayArtist || 'Unknown Artist'}/{displayAlbum}/</div>
              </div>

              {/* Track list */}
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
