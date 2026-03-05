import { requireAiPlanBuilderAuditAdminUserPage } from '@/modules/ai-plan-builder/server/audit-admin';
import { AdminAiEngineControlsPage } from '@/modules/ai-plan-builder/ui/AdminAiEngineControlsPage';

export default async function AiPlanBuilderEngineControlsAdminPage() {
  await requireAiPlanBuilderAuditAdminUserPage();
  return <AdminAiEngineControlsPage />;
}
