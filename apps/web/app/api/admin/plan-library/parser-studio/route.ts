import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { listParserStudioSources } from '@/modules/plan-library/server/parser-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const data = await listParserStudioSources();
    return success(data);
  } catch (error) {
    return handleError(error);
  }
}
