import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';

import { Card } from '@/components/ui/Card';

const DESKTOP_NAV_LINK_CLASS =
  'rounded-full px-3 py-2 min-h-[44px] inline-flex items-center text-[var(--muted)] hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]';

export async function AdminHeader() {
  const { userId } = await auth();

  return (
    <header className="sticky top-0 z-50 bg-[var(--bg-page)] px-4 pt-2 md:px-6 md:pt-6">
      <Card className="rounded-3xl bg-[var(--bg-surface)] p-0">
        <div className="flex h-14 items-center justify-between gap-3 px-3 md:h-auto md:px-5 md:py-5">
          <Link
            href="/admin/workout-library"
            className="inline-flex items-center gap-2 rounded-full px-2 py-1 font-display font-semibold tracking-tight text-[var(--text)]"
            aria-label="CoachKit Admin"
          >
            <span className="text-sm md:text-base">CoachKit</span>
            <span className="rounded-full bg-[var(--bg-structure)] px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--muted)]">
              ADMIN
            </span>
          </Link>

          <nav className="hidden md:flex flex-wrap gap-2 text-sm font-medium uppercase">
            <Link href="/admin/workout-library" className={`${DESKTOP_NAV_LINK_CLASS} whitespace-nowrap`}>
              Workout Library
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            {userId && <UserButton afterSignOutUrl="/" />}
          </div>
        </div>
      </Card>
    </header>
  );
}
