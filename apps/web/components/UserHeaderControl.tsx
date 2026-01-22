'use client';

import { useClerk, useUser } from '@clerk/nextjs';

import { cn } from '@/lib/cn';

function getDisplayName(user: ReturnType<typeof useUser>['user']): string {
  const first = (user?.firstName ?? '').trim();
  const last = (user?.lastName ?? '').trim();
  const firstLast = `${first} ${last}`.trim();
  if (firstLast) return firstLast;

  const fullName = (user?.fullName ?? '').trim();
  if (fullName) return fullName;

  const username = (user?.username ?? '').trim();
  if (username) return username;

  return 'Account';
}

function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return 'A';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

type UserHeaderControlProps = {
  className?: string;
};

export function UserHeaderControl({ className }: UserHeaderControlProps) {
  const { openUserProfile } = useClerk();
  const { user, isLoaded } = useUser();

  const displayName = getDisplayName(user);
  const avatarUrl = user?.imageUrl ?? '';
  const disabled = !isLoaded;

  return (
    <button
      type="button"
      data-testid="user-header-control"
      onClick={() => (disabled ? null : openUserProfile())}
      disabled={disabled}
      className={cn(
        'group inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-2 min-h-[44px]',
        'text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]',
        disabled ? 'opacity-60' : 'cursor-pointer',
        className
      )}
      aria-label="Account"
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-structure)] text-xs font-semibold text-[var(--muted)]">
          {initialsFromName(displayName)}
        </div>
      )}

      <span
        data-testid="user-header-name"
        className="min-w-0 truncate text-sm font-medium text-[var(--text)]"
      >
        {displayName}
      </span>
    </button>
  );
}
