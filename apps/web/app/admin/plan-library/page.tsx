import nextDynamic from 'next/dynamic';

import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const AdminPlanLibraryWorkspace = nextDynamic(
  () =>
    import('@/components/admin/AdminPlanLibraryWorkspace').then((mod) => mod.AdminPlanLibraryWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-7xl p-6">
        <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-10 text-sm text-[var(--muted)]">
          Loading plan library…
        </div>
      </div>
    ),
  }
);

export default async function AdminPlanLibraryPage() {
  let adminEmail: string | null = null;
  try {
    const requester = await requireAdmin();
    adminEmail = requester.user.email;
  } catch {
    adminEmail = null;
  }

  return <AdminPlanLibraryWorkspace adminEmail={adminEmail} />;
}
