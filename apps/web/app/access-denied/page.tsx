import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export default function AccessDenied() {
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
          <Link href="/">
            <Button className="w-full">Return Home</Button>
          </Link>
          <a href="/sign-out" className="text-sm text-[var(--muted)] hover:underline">
            Sign Out
          </a>
        </div>
      </Card>
    </div>
  );
}
