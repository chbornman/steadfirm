import { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { Card, Form, Input, Button, Typography, Divider, App } from 'antd';
import { GoogleLogo } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { Wordmark } from '@steadfirm/ui';
import { signUp, signIn } from '@/hooks/useAuth';
import { AuthLayout } from '@/layouts/AuthLayout';

const { Title, Text } = Typography;

interface SignupForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function SignupPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: SignupForm) => {
    if (values.password !== values.confirmPassword) {
      void message.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const result = await signUp.email({
        name: values.name,
        email: values.email,
        password: values.password,
      });
      if (result.error) {
        void message.error(result.error.message ?? 'Signup failed');
      } else {
        void navigate({ to: '/photos' });
      }
    } catch {
      void message.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    try {
      await signIn.social({ provider: 'google', callbackURL: '/photos' });
    } catch {
      void message.error('Google sign-up failed');
    }
  };

  return (
    <AuthLayout>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Wordmark size={36} accentColor={cssVar.accent} />
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Title level={4} style={{ textAlign: 'center', marginBottom: 24 }}>
          Create account
        </Title>

        <Form<SignupForm> layout="vertical" onFinish={(values) => void handleSubmit(values)} size="large">
          <Form.Item
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="Full name" autoComplete="name" />
          </Form.Item>

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
            rules={[
              { required: true, message: 'Password is required' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password placeholder="Password" autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            rules={[{ required: true, message: 'Please confirm your password' }]}
          >
            <Input.Password placeholder="Confirm password" autoComplete="new-password" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{ height: 44 }}
            >
              Create account
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
          onClick={() => void handleGoogleSignUp()}
          style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          Sign up with Google
        </Button>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Text type="secondary">
            Already have an account?{' '}
            <Link to="/login" style={{ color: cssVar.accent }}>
              Sign in
            </Link>
          </Text>
        </div>
      </Card>
    </AuthLayout>
  );
}
