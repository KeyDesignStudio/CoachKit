import { requireAdmin } from '@/lib/auth';
import { TrustedKnowledgeSourcesConsole } from '@/components/admin/TrustedKnowledgeSourcesConsole';

export const dynamic = 'force-dynamic';

export default async function AdminKnowledgeSourcesPage() {
  const requester = await requireAdmin();

  return <TrustedKnowledgeSourcesConsole key={requester.user.email} />;
}
