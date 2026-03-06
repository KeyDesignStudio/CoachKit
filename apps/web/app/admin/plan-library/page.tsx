import { requireAdmin } from '@/lib/auth';

import { AdminPlanLibraryWorkspace } from '@/components/admin/AdminPlanLibraryWorkspace';

export const dynamic = 'force-dynamic';

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
