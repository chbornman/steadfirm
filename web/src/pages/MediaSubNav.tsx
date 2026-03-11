import { Segmented } from 'antd';
import { useNavigate, useRouterState } from '@tanstack/react-router';

const segments = [
  { label: 'Movies', value: '/media/movies' },
  { label: 'Shows', value: '/media/shows' },
];

export function MediaSubNav() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const path = routerState.location.pathname;

  const active =
    segments.find((s) => path.startsWith(s.value))?.value ?? '/media/movies';

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <Segmented
        value={active}
        onChange={(value) => {
          const target = typeof value === 'string' ? value : '';
          void navigate({ to: target });
        }}
        options={segments}
        size="middle"
      />
    </div>
  );
}
