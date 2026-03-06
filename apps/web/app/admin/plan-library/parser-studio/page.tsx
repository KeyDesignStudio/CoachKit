import { requireAdmin } from '@/lib/auth';

import { PlanLibraryParserStudio } from '@/components/admin/PlanLibraryParserStudio';

export const dynamic = 'force-dynamic';

export default async function AdminPlanLibraryParserStudioPage({
  searchParams,
}: {
  searchParams?: { sourceId?: string };
}) {
  const requester = await requireAdmin();

  return (
    <PlanLibraryParserStudio
      adminEmail={requester.user.email}
      initialSourceId={typeof searchParams?.sourceId === 'string' ? searchParams.sourceId : null}
    />
  );
}
