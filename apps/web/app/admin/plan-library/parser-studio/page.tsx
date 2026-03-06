import { requireAdmin } from '@/lib/auth';

import { PlanLibraryParserStudio } from '@/components/admin/PlanLibraryParserStudio';

export const dynamic = 'force-dynamic';

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
      adminEmail={adminEmail}
      initialSourceId={typeof searchParams?.sourceId === 'string' ? searchParams.sourceId : null}
    />
  );
}
