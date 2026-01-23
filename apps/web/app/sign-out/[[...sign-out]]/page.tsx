'use client';

import { useClerk } from '@clerk/nextjs';
import { useEffect } from 'react';

export default function SignOutPage() {
  const { signOut } = useClerk();

  useEffect(() => {
    void signOut({ redirectUrl: '/' });
  }, [signOut]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-sm text-[var(--muted)]">Signing out…</div>
    </div>
  );
}
