import { Skeleton } from 'antd';

export function PhotoGridSkeleton() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 4,
        padding: 0,
      }}
    >
      {Array.from({ length: 24 }).map((_, i) => (
        <Skeleton.Image
          key={i}
          active
          style={{
            width: '100%',
            height: 180 + Math.random() * 80,
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

export function PosterGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: '16px 8px',
        padding: '0 8px',
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <Skeleton.Image
            active
            style={{
              width: '100%',
              aspectRatio: '2 / 3',
              borderRadius: 4,
            }}
          />
          <Skeleton
            active
            title={{ width: '80%' }}
            paragraph={{ rows: 0 }}
            style={{ marginTop: 8 }}
          />
        </div>
      ))}
    </div>
  );
}

export function DocumentGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12,
        padding: '0 16px',
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            border: '1px solid var(--ant-color-border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <Skeleton.Image
            active
            style={{
              width: '100%',
              aspectRatio: '3 / 4',
            }}
          />
          <div style={{ padding: 12 }}>
            <Skeleton active title={{ width: '70%' }} paragraph={{ rows: 1, width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div style={{ padding: '16px' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          active
          title={false}
          paragraph={{ rows: 1, width: '100%' }}
          style={{ marginBottom: 16 }}
        />
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', gap: 24 }}>
        <Skeleton.Image
          active
          style={{ width: 200, height: 300, borderRadius: 8, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <Skeleton active title={{ width: '60%' }} paragraph={{ rows: 3 }} />
        </div>
      </div>
    </div>
  );
}
