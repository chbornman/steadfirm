import { useState, useEffect } from 'react';
import {
  Typography,
  Input,
  Button,
  Card,
  Avatar,
  App,
  Tooltip,
  Skeleton,
} from 'antd';
import {
  User,
  Lock,
  PaintBrush,
  NavigationArrow,
  Sun,
  Moon,
  Desktop,
  SignOut,
  Check,
  Devices,
} from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { authClient } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePreferencesStore,
  ALL_TAB_KEYS,
  TAB_LABELS,
} from '@/stores/preferences';
import type { TabKey } from '@/stores/preferences';

const { Title, Text } = Typography;

/** Vertical gap between settings sections */
const SECTION_GAP = 32;

type ThemeMode = 'dark' | 'light' | 'system';

const themeOptions: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Desktop },
];

interface SessionEntry {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: Date;
  expiresAt: Date;
}

function SectionHeader({ icon: Icon, title }: { icon: typeof User; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
      <Icon size={20} weight="duotone" />
      <Title level={4} style={{ margin: 0 }}>
        {title}
      </Title>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Text
        type="secondary"
        style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}
      >
        {label}
      </Text>
      {children}
    </div>
  );
}

// -- Profile Section --

function ProfileSection() {
  const user = useCurrentUser();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);

  const nameChanged = name.trim() !== user.name;
  const emailChanged = email.trim() !== user.email;
  const hasChanges = nameChanged || emailChanged;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (nameChanged) {
        const res = await authClient.updateUser({ name: name.trim() });
        if (res.error) {
          void message.error(res.error.message ?? 'Failed to update name');
          setSaving(false);
          return;
        }
      }
      if (emailChanged) {
        const res = await authClient.changeEmail({ newEmail: email.trim() });
        if (res.error) {
          void message.error(res.error.message ?? 'Failed to update email');
          setSaving(false);
          return;
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      void message.success('Profile updated');
    } catch {
      void message.error('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Card variant="borderless" style={{ background: 'var(--ant-color-bg-container)' }}>
      <SectionHeader icon={User} title="Profile" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Avatar
          size={56}
          style={{
            background: cssVar.accent,
            fontSize: 20,
            fontWeight: 600,
          }}
        >
          {initials}
        </Avatar>
        <div>
          <Text strong style={{ fontSize: 16 }}>
            {user.name}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>
            {user.email}
          </Text>
        </div>
      </div>

      <FieldRow label="Display name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{ maxWidth: 360 }}
        />
      </FieldRow>

      <FieldRow label="Email address">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          type="email"
          style={{ maxWidth: 360 }}
        />
      </FieldRow>

      <Button
        type="primary"
        onClick={() => void handleSave()}
        loading={saving}
        disabled={!hasChanges}
        style={{ marginTop: 4 }}
      >
        Save changes
      </Button>
    </Card>
  );
}

// -- Security Section --

function SecuritySection() {
  const { message } = App.useApp();

  // Change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const passwordsMatch = newPassword === confirmPassword;
  const canChangePassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    passwordsMatch;

  const handleChangePassword = async () => {
    setChangingPassword(true);
    try {
      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
      });
      if (res.error) {
        void message.error(res.error.message ?? 'Failed to change password');
      } else {
        void message.success('Password changed');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      void message.error('Something went wrong');
    } finally {
      setChangingPassword(false);
    }
  };

  // Sessions
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingAll, setRevokingAll] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authClient.listSessions();
        if (res.data) {
          setSessions(res.data as SessionEntry[]);
        }
      } catch {
        // Silently fail — sessions are non-critical
      } finally {
        setLoadingSessions(false);
      }
    })();
  }, []);

  const handleRevokeOthers = async () => {
    setRevokingAll(true);
    try {
      await authClient.revokeOtherSessions();
      // Refresh session list
      const res = await authClient.listSessions();
      if (res.data) {
        setSessions(res.data as SessionEntry[]);
      }
      void message.success('All other sessions revoked');
    } catch {
      void message.error('Failed to revoke sessions');
    } finally {
      setRevokingAll(false);
    }
  };

  const handleRevokeSession = async (sessionToken: string) => {
    try {
      await authClient.revokeSession({ token: sessionToken });
      setSessions((prev) => prev?.filter((s) => s.token !== sessionToken) ?? null);
      void message.success('Session revoked');
    } catch {
      void message.error('Failed to revoke session');
    }
  };

  const parseUserAgent = (ua?: string | null): string => {
    if (!ua) return 'Unknown device';
    // Simple browser detection
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Edg/')) return 'Microsoft Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Mobile')) return 'Mobile browser';
    return 'Browser';
  };

  return (
    <Card variant="borderless" style={{ background: 'var(--ant-color-bg-container)' }}>
      <SectionHeader icon={Lock} title="Security" />

      {/* Change password */}
      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        Change password
      </Text>

      <FieldRow label="Current password">
        <Input.Password
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Enter current password"
          style={{ maxWidth: 360 }}
        />
      </FieldRow>

      <FieldRow label="New password">
        <Input.Password
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
          style={{ maxWidth: 360 }}
        />
      </FieldRow>

      <FieldRow label="Confirm new password">
        <Input.Password
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repeat new password"
          style={{ maxWidth: 360 }}
          status={confirmPassword.length > 0 && !passwordsMatch ? 'error' : undefined}
        />
        {confirmPassword.length > 0 && !passwordsMatch && (
          <Text type="danger" style={{ fontSize: 12, marginTop: 2 }}>
            Passwords do not match
          </Text>
        )}
      </FieldRow>

      <Button
        type="primary"
        onClick={() => void handleChangePassword()}
        loading={changingPassword}
        disabled={!canChangePassword}
        style={{ marginTop: 4 }}
      >
        Update password
      </Button>

      {/* Active sessions */}
      <div style={{ marginTop: SECTION_GAP }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Text strong>Active sessions</Text>
          {sessions && sessions.length > 1 && (
            <Button
              size="small"
              danger
              icon={<SignOut size={14} />}
              loading={revokingAll}
              onClick={() => void handleRevokeOthers()}
            >
              Revoke all others
            </Button>
          )}
        </div>

        {loadingSessions ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : sessions && sessions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.map((session, idx) => {
              const isCurrent = idx === 0; // BetterAuth returns current session first
              return (
                <div
                  key={session.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'var(--ant-color-fill-quaternary)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Devices size={18} color="var(--ant-color-text-secondary)" />
                    <div>
                      <Text style={{ fontSize: 13 }}>
                        {parseUserAgent(session.userAgent)}
                        {isCurrent && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              color: cssVar.accent,
                              fontWeight: 600,
                            }}
                          >
                            This device
                          </span>
                        )}
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        Created {new Date(session.createdAt).toLocaleDateString()}
                      </Text>
                    </div>
                  </div>
                  {!isCurrent && (
                    <Tooltip title="Revoke session">
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<SignOut size={14} />}
                        onClick={() => void handleRevokeSession(session.token)}
                      />
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>
            No active sessions found
          </Text>
        )}
      </div>
    </Card>
  );
}

// -- Navigation Section --

function NavigationSection() {
  const showAllTabs = usePreferencesStore((s) => s.showAllTabs);
  const hiddenTabs = usePreferencesStore((s) => s.hiddenTabs);
  const setShowAllTabs = usePreferencesStore((s) => s.setShowAllTabs);
  const toggleTab = usePreferencesStore((s) => s.toggleTab);

  return (
    <Card variant="borderless" style={{ background: 'var(--ant-color-bg-container)' }}>
      <SectionHeader icon={NavigationArrow} title="Navigation" />

      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
        Choose which tabs appear in the navigation bar. Hidden tabs and their
        content are still accessible via search and direct links.
      </Text>

      {/* Show all toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'var(--ant-color-fill-quaternary)',
          marginBottom: 12,
        }}
      >
        <div>
          <Text strong style={{ fontSize: 13 }}>
            Show all tabs
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Display every tab regardless of individual settings
          </Text>
        </div>
        <button
          onClick={() => setShowAllTabs(!showAllTabs)}
          style={{
            position: 'relative',
            width: 44,
            height: 24,
            borderRadius: 12,
            border: 'none',
            background: showAllTabs ? cssVar.accent : 'var(--ant-color-fill-secondary)',
            cursor: 'pointer',
            transition: 'background 0.2s ease',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: showAllTabs ? 22 : 2,
              width: 20,
              height: 20,
              borderRadius: 10,
              background: '#fff',
              transition: 'left 0.2s ease',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
            }}
          />
        </button>
      </div>

      {/* Per-tab toggles */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          opacity: showAllTabs ? 0.5 : 1,
          pointerEvents: showAllTabs ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
        }}
      >
        {ALL_TAB_KEYS.map((key: TabKey) => {
          const isVisible = !hiddenTabs.includes(key);
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 13 }}>{TAB_LABELS[key]}</Text>
              <button
                onClick={() => toggleTab(key)}
                style={{
                  position: 'relative',
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  border: 'none',
                  background: isVisible ? cssVar.accent : 'var(--ant-color-fill-secondary)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: isVisible ? 22 : 2,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    background: '#fff',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// -- Appearance Section --

function AppearanceSection() {
  const { mode, setMode } = useTheme();

  return (
    <Card variant="borderless" style={{ background: 'var(--ant-color-bg-container)' }}>
      <SectionHeader icon={PaintBrush} title="Appearance" />

      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
        Choose how Steadfirm looks on your device.
      </Text>

      <div style={{ display: 'flex', gap: 12 }}>
        {themeOptions.map((opt) => {
          const Icon = opt.icon;
          const isSelected = mode === opt.mode;
          return (
            <button
              key={opt.mode}
              onClick={() => setMode(opt.mode)}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: '16px 24px',
                border: isSelected
                  ? `2px solid ${cssVar.accent}`
                  : '2px solid var(--ant-color-border)',
                borderRadius: 12,
                background: isSelected
                  ? cssVar.accentSubtle
                  : 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: isSelected ? 600 : 400,
                color: isSelected ? 'var(--ant-color-text)' : 'var(--ant-color-text-secondary)',
                transition: 'all 0.15s ease',
                minWidth: 90,
              }}
            >
              {isSelected && (
                <Check
                  size={14}
                  weight="bold"
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    color: cssVar.accent,
                  }}
                />
              )}
              <Icon size={24} weight={isSelected ? 'fill' : 'duotone'} />
              {opt.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// -- Settings Page --

export function SettingsPage() {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '24px 16px 64px',
      }}
    >
      <Title level={3} style={{ marginBottom: 24 }}>
        Settings
      </Title>

      <div style={{ display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
        <ProfileSection />
        <NavigationSection />
        <SecuritySection />
        <AppearanceSection />
      </div>
    </div>
  );
}
