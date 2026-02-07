import { redirect } from 'next/navigation';

import { ApiError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams?: { reason?: string };
}) {
  const reason = searchParams?.reason;

  // Explicit forbidden state: show stable denied UI (no role-based redirect)
  if (reason === 'forbidden') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md rounded-3xl p-8 text-center">
          <h1 className="mb-4 text-2xl font-semibold">Access denied</h1>
          <p className="mb-6 text-[var(--muted)]">You do not have permission to view this page.</p>
          <div className="flex flex-col gap-3">
            <a href="/" className="w-full">
              <Button className="w-full">Return Home</Button>
            </a>
            <a href="/sign-out" className="text-sm text-[var(--muted)] hover:underline">
              Sign Out
            </a>
          </div>
        </Card>
      </div>
    );
  }

  try {
    const { user } = await requireAuth();

    if (user.role === 'ADMIN') {
      console.info('[Authz] Access-denied redirect', { role: user.role, userId: user.id, target: '/admin/ai-usage' });
      redirect('/admin/ai-usage');
    }
    if (user.role === 'COACH') redirect('/coach/dashboard');
    if (user.role === 'ATHLETE') redirect('/athlete/dashboard');

    // Unknown role: treat as not invited.
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md rounded-3xl p-8 text-center">
          <h1 className="mb-4 text-2xl font-semibold">Access Not Granted</h1>
          <p className="mb-6 text-[var(--muted)]">
            Your account is not authorized to access CoachKit. This is an invite-only platform.
          </p>
          <div className="flex flex-col gap-3">
            <a href="/sign-out" className="w-full">
              <Button className="w-full">Sign Out</Button>
            </a>
          </div>
        </Card>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect('/sign-in');

      // Authenticated but not invited
      if (error.status === 403) {
        return (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Card className="max-w-md rounded-3xl p-8 text-center">
              <h1 className="mb-4 text-2xl font-semibold">Access Not Granted</h1>
              <p className="mb-6 text-[var(--muted)]">
                Your account is not authorized to access CoachKit. This is an invite-only platform.
              </p>
              <p className="mb-6 text-sm text-[var(--muted)]">
                If you believe you should have access, please contact your coach or administrator.
              </p>
              <div className="flex flex-col gap-3">
                <a href="/sign-in" className="w-full">
                  <Button className="w-full">Return to Sign In</Button>
                </a>
                <a href="/sign-out" className="text-sm text-[var(--muted)] hover:underline">
                  Sign Out
                </a>
              </div>
            </Card>
          </div>
        );
      }
    }

    throw error;
  }
}
