'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';

import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { useAuthUser } from '@/components/use-auth-user';

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
  const { user: authUser } = useAuthUser();
  const pathname = usePathname();
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 260 });

  const displayName = getDisplayName(user);
  const avatarUrl = user?.imageUrl ?? '';
  const disabled = !isLoaded;
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((v) => !v);
  }, [disabled]);

  useEffect(() => {
    // Close menu on navigation.
    close();
  }, [close, pathname]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    if (!buttonRef.current) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const desiredWidth = Math.min(320, Math.max(240, window.innerWidth - 16));
      const minLeft = 8;
      const maxLeft = Math.max(8, window.innerWidth - desiredWidth - 8);

      // Right-align to the button by default.
      const desiredLeft = rect.right + window.scrollX - desiredWidth;
      const clampedLeft = Math.min(maxLeft, Math.max(minLeft, desiredLeft));

      setMenuPosition({
        top: rect.bottom + window.scrollY + 8,
        left: clampedLeft + window.scrollX,
        width: desiredWidth,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const menu = useMemo(() => {
    if (!open) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
      <>
        <div className="fixed inset-0 z-[100]" onClick={close} />
        <div
          role="menu"
          aria-label="Account menu"
          className={cn(
            'fixed z-[110] overflow-hidden rounded-2xl border border-[var(--border-subtle)]',
            'bg-[var(--bg-surface)] shadow-[0_18px_48px_-32px_rgba(15,23,42,0.55)]'
          )}
          style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }}
        >
          <div className="px-4 py-3">
            <div className="text-sm font-semibold text-[var(--text)] truncate">{displayName}</div>
            <div className="text-xs text-[var(--muted)] truncate">Account</div>
          </div>
          <div className="h-px bg-[var(--border-subtle)]" />
          <div className="p-2">
            <button
              type="button"
              role="menuitem"
              className={cn(
                'w-full min-h-[44px] rounded-xl px-3',
                'inline-flex items-center gap-2',
                'text-sm font-medium text-[var(--text)]',
                'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
              )}
              onClick={() => {
                close();
                openUserProfile();
              }}
            >
              <Icon name="settings" size="sm" className="text-[var(--muted)]" />
              <span>Account settings</span>
            </button>

            {authUser?.role === 'ATHLETE' ? (
              <button
                type="button"
                role="menuitem"
                className={cn(
                  'mt-1 w-full min-h-[44px] rounded-xl px-3',
                  'inline-flex items-center gap-2',
                  'text-sm font-medium text-[var(--text)]',
                  'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
                )}
                onClick={() => {
                  close();
                  router.push('/athlete/profile');
                }}
              >
                <Icon name="info" size="sm" className="text-[var(--muted)]" />
                <span>Athlete profile</span>
              </button>
            ) : null}

            <button
              type="button"
              role="menuitem"
              className={cn(
                'mt-1 w-full min-h-[44px] rounded-xl px-3',
                'inline-flex items-center gap-2',
                'text-sm font-medium text-[var(--text)]',
                'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
              )}
              onClick={() => {
                close();
                void signOut({ redirectUrl: '/' });
              }}
            >
              <Icon name="logout" size="sm" className="text-[var(--muted)]" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </>,
      document.body
    );
  }, [authUser?.role, close, displayName, menuPosition.left, menuPosition.top, menuPosition.width, open, openUserProfile, router, signOut]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="user-header-control"
        onClick={toggle}
        disabled={disabled}
        className={cn(
          'group inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-2 min-h-[44px]',
          'text-[var(--text)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]',
          disabled ? 'opacity-60' : 'cursor-pointer',
          className
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-structure)] text-xs font-semibold text-[var(--muted)]">
            {initialsFromName(displayName)}
          </div>
        )}

        <Icon name={open ? 'close' : 'expandMore'} size="sm" className="text-[var(--muted)]" aria-hidden />
      </button>

      {menu}
    </>
  );
}
