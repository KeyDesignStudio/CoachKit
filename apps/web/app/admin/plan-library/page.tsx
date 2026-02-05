import { requireAdmin } from '@/lib/auth';

import { PlanLibraryIngestForm } from '@/components/admin/PlanLibraryIngestForm';

export const dynamic = 'force-dynamic';

export default async function AdminPlanLibraryPage() {
  const requester = await requireAdmin();

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Plan Library (PlanSource v1)</h1>
        <div className="text-sm text-muted-foreground">Admin: {requester.user.email}</div>
      </div>

      <PlanLibraryIngestForm />
    </div>
  );
}
