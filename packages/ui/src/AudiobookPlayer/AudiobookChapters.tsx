import { formatDuration } from '@steadfirm/shared';
import { colors } from '@steadfirm/theme';

export interface AudiobookChaptersProps {
  chapters: { id: string; title: string; start: number; end: number }[];
  currentChapter: number;
  onSelect: (index: number) => void;
}

export function AudiobookChapters({ chapters, currentChapter, onSelect }: AudiobookChaptersProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {chapters.map((chapter, index) => {
        const isCurrent = index === currentChapter;
        const chapterDuration = chapter.end - chapter.start;

        return (
          <button
            key={chapter.id}
            onClick={() => onSelect(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              border: 'none',
              borderLeft: isCurrent
                ? `3px solid ${colors.accent}`
                : '3px solid transparent',
              background: isCurrent
                ? 'var(--ant-color-bg-text-hover)'
                : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              transition: 'background 150ms ease-out',
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: 'var(--ant-color-text-secondary)',
                fontVariantNumeric: 'tabular-nums',
                minWidth: 24,
              }}
            >
              {index + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: isCurrent ? 500 : 400,
                  color: isCurrent ? colors.accent : 'var(--ant-color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {chapter.title}
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                color: 'var(--ant-color-text-secondary)',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {formatDuration(chapterDuration)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
