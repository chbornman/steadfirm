import { useNavigate } from '@tanstack/react-router';
import { Result, Button } from 'antd';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 120px)',
      }}
    >
      <Result
        status="404"
        title="Page not found"
        subTitle="The page you're looking for doesn't exist."
        extra={
          <Button type="primary" onClick={() => void navigate({ to: '/photos' })}>
            Go to Photos
          </Button>
        }
      />
    </div>
  );
}
