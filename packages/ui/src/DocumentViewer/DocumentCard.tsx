import { Tag } from 'antd';
import { motion } from 'framer-motion';
import { gridItem as gridItemVariant } from '@steadfirm/theme';
import type { Document } from '@steadfirm/shared';

export interface DocumentCardProps {
  document: Document;
  onClick: (document: Document) => void;
}

export function DocumentCard({ document, onClick }: DocumentCardProps) {
  return (
    <motion.div
      variants={gridItemVariant}
      className="doc-card"
      onClick={() => onClick(document)}
      style={{
        cursor: 'pointer',
        border: '1px solid var(--ant-color-border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--ant-color-bg-container)',
        transition: 'box-shadow 150ms ease-out, transform 150ms ease-out, border-color 150ms ease-out',
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: '100%',
          aspectRatio: '3 / 4',
          overflow: 'hidden',
          background: 'var(--ant-color-bg-layout)',
        }}
      >
        <img
          src={document.thumbnailUrl}
          alt={document.title}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: '18px',
            minHeight: 36,
          }}
        >
          {document.title}
        </div>

        {document.correspondent && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ant-color-text-secondary)',
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {document.correspondent}
          </div>
        )}

        <div
          style={{
            fontSize: 11,
            color: 'var(--ant-color-text-tertiary)',
            marginTop: 4,
          }}
        >
          {new Date(document.dateCreated).toLocaleDateString()}
        </div>

        {document.tags.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              marginTop: 8,
            }}
          >
            {document.tags.slice(0, 3).map((tag) => (
              <Tag
                key={tag}
                style={{ fontSize: 10, lineHeight: '18px', margin: 0 }}
              >
                {tag}
              </Tag>
            ))}
            {document.tags.length > 3 && (
              <Tag style={{ fontSize: 10, lineHeight: '18px', margin: 0 }}>
                +{document.tags.length - 3}
              </Tag>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
