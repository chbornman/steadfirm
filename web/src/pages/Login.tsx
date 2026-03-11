import { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { Card, Form, Input, Button, Typography, Divider, App } from 'antd';
import { GoogleLogo } from '@phosphor-icons/react';
import { colors } from '@steadfirm/theme';
import { signIn } from '@/hooks/useAuth';
import { AuthLayout } from '@/layouts/AuthLayout';

const { Title, Text } = Typography;

interface LoginForm {
  email: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: LoginForm) => {
    setLoading(true);
    try {
      const result = await signIn.email({
        email: values.email,
        password: values.password,
      });
      if (result.error) {
        void message.error(result.error.message ?? 'Invalid credentials');
      } else {
        void navigate({ to: '/photos' });
      }
    } catch {
      void message.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signIn.social({ provider: 'google', callbackURL: '/photos' });
    } catch {
      void message.error('Google sign-in failed');
    }
  };

  return (
    <AuthLayout>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 8,
            background: colors.accent,
            margin: '0 auto 16px',
          }}
        />
        <Title level={3} style={{ margin: 0 }}>
          Steadfirm
        </Title>
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Title level={4} style={{ textAlign: 'center', marginBottom: 24 }}>
          Sign in
        </Title>

        <Form<LoginForm> layout="vertical" onFinish={(values) => void handleSubmit(values)} size="large">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Email is required' },
              { type: 'email', message: 'Invalid email' },
            ]}
          >
            <Input placeholder="Email" autoComplete="email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Password is required' }]}
          >
            <Input.Password placeholder="Password" autoComplete="current-password" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{ height: 44 }}
            >
              Sign in
            </Button>
          </Form.Item>
        </Form>

        <Divider plain>
          <Text type="secondary" style={{ fontSize: 12 }}>
            or
          </Text>
        </Divider>

        <Button
          block
          icon={<GoogleLogo size={18} weight="bold" />}
          onClick={() => void handleGoogleSignIn()}
          style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          Sign in with Google
        </Button>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Text type="secondary">
            No account?{' '}
            <Link to="/signup" style={{ color: colors.accent }}>
              Sign up
            </Link>
          </Text>
        </div>
      </Card>
    </AuthLayout>
  );
}
