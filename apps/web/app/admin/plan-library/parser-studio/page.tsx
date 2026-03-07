import nextDynamic from 'next/dynamic';

import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PlanLibraryParserStudio = nextDynamic(
  () =>
    import('@/components/admin/PlanLibraryParserStudio').then((mod) => mod.PlanLibraryParserStudio),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-7xl p-6">
        <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] px-4 py-10 text-sm text-[var(--muted)]">
          Loading parser studio…
        </div>
      </div>
    ),
  }
);

export default async function AdminPlanLibraryParserStudioPage({
  searchParams,
}: {
  searchParams?: { sourceId?: string };
}) {
  let adminEmail: string | null = null;
  try {
    const requester = await requireAdmin();
    adminEmail = requester.user.email;
  } catch {
    adminEmail = null;
  }

  return (
    <PlanLibraryParserStudio
      adminEmail={adminEmail ?? ''}
      initialSourceId={typeof searchParams?.sourceId === 'string' ? searchParams.sourceId : null}
    />
  );
}
