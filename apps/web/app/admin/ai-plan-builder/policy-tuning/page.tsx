import { requireAiPlanBuilderAuditAdminUserPage } from '@/modules/ai-plan-builder/server/audit-admin';
import { AdminPolicyTuningPage } from '@/modules/ai-plan-builder/ui/AdminPolicyTuningPage';

export default async function AiPlanBuilderPolicyTuningAdminPage() {
  await requireAiPlanBuilderAuditAdminUserPage();
  return <AdminPolicyTuningPage />;
}

