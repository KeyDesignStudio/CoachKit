'use client';

import { FormEvent, useState } from 'react';

import { useUser, UserRoleType } from '@/components/user-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

function DevUserSwitcher() {
  const { user, setUser } = useUser();
  const [userId, setUserId] = useState(user.userId);
  const [role, setRole] = useState<UserRoleType>(user.role);
  const [message, setMessage] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!userId.trim()) {
      setMessage('User ID is required to call APIs.');
      return;
    }

    setUser({ userId: userId.trim(), role });
    setMessage('Saved. Headers will include this user for API calls.');
    setTimeout(() => setMessage(''), 2500);
  }

  return (
    <Card className="rounded-3xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-[var(--muted)]">
          Active Role
          <Select value={role} onChange={(event) => setRole(event.target.value as UserRoleType)}>
            <option value="COACH">Coach</option>
            <option value="ATHLETE">Athlete</option>
          </Select>
        </label>
        <label className="flex flex-[2] flex-col gap-2 text-sm font-medium text-[var(--muted)]">
          User ID (cuid)
          <Input
            placeholder="Paste cuid from your DB"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <div className="flex flex-col gap-2">
          <Button type="submit" size="md">
            Use identity
          </Button>
          {message ? <span className="text-xs font-medium text-emerald-600">{message}</span> : null}
        </div>
      </form>
      <p className="mt-3 text-sm text-[var(--muted)]">
        Requests from this tab include the `x-user-id` header and rely on your role selection for client-side hints. Server routes still enforce roles.
      </p>
    </Card>
  );
}

/**
 * UserSwitcher - Development-only identity switcher
 * 
 * This component is hidden in production builds. To show it:
 * - Set NODE_ENV !== 'production', OR
 * - Set NEXT_PUBLIC_SHOW_DEV_SWITCHER=true
 * 
 * In production deployments (Vercel), this will be automatically hidden.
 */
export function UserSwitcher() {
  // Check if dev switcher should be shown
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const showDevSwitcher = process.env.NEXT_PUBLIC_SHOW_DEV_SWITCHER === 'true';
  
  if (!isDevelopment && !showDevSwitcher) {
    return null;
  }

  return <DevUserSwitcher />;
}
