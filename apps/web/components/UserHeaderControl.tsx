'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
  const { openUserProfile, signOut } = useClerk();
  const { user, isLoaded } = useUser();
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const displayName = getDisplayName(user);
  const avatarUrl = user?.imageUrl ?? '';
  const disabled = !isLoaded;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!wrapperRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const openAccount = async () => {
    setOpen(false);
    if (disabled) return;
    openUserProfile();
  };

  const doSignOut = async () => {
    setOpen(false);
    if (disabled) return;
    await signOut({ redirectUrl: '/' });
  };

  return (
    <div ref={wrapperRef} className={cn('relative inline-flex min-w-0', className)}>
      <button
        type="button"
        data-testid="user-header-control"
        onClick={() => (disabled ? null : setOpen((v) => !v))}
        disabled={disabled}
        className={cn(
          'group inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-2 min-h-[44px]',
          'text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]',
          disabled ? 'opacity-60' : 'cursor-pointer'
        )}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
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

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account menu"
          className={cn(
            'absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-glass',
            'py-1'
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={openAccount}
            className="w-full px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:bg-[var(--bg-structure)]"
          >
            Account
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={doSignOut}
            className="w-full px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:bg-[var(--bg-structure)]"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
