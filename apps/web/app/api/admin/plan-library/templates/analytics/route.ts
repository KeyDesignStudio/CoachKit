import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getPlanLibraryTemplateAnalytics } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const analytics = await getPlanLibraryTemplateAnalytics();
    return success({ analytics });
  } catch (error) {
    return handleError(error);
  }
}

