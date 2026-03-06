import { requireAdmin } from '@/lib/auth';

import { AdminPlanLibraryWorkspace } from '@/components/admin/AdminPlanLibraryWorkspace';

export const dynamic = 'force-dynamic';

export default async function AdminPlanLibraryPage() {
  const requester = await requireAdmin();

  return <AdminPlanLibraryWorkspace adminEmail={requester.user.email} />;
}
