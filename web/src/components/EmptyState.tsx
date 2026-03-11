import type { ReactNode } from 'react';
import { Typography, Button } from 'antd';
import { useNavigate } from '@tanstack/react-router';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  showUploadLink?: boolean;
}

export function EmptyState({ icon, title, description, showUploadLink = true }: EmptyStateProps) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 250px)',
        color: 'var(--ant-color-text-secondary)',
        padding: 24,
      }}
    >
      <div style={{ color: 'var(--ant-color-text-quaternary)' }}>{icon}</div>
      <Typography.Title level={4} type="secondary" style={{ marginTop: 16 }}>
        {title}
      </Typography.Title>
      {description && (
        <Typography.Text type="secondary">{description}</Typography.Text>
      )}
      {showUploadLink && (
        <Button
          type="link"
          onClick={() => void navigate({ to: '/upload' })}
          style={{ marginTop: 8 }}
        >
          Upload your first files
        </Button>
      )}
    </div>
  );
}
