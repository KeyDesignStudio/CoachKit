import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { listTrustedKnowledgeSources, updateTrustedKnowledgeSource } from '@/lib/knowledge/trusted-sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  id: z.string().trim().min(1),
  planningEnabled: z.boolean().optional(),
  qaEnabled: z.boolean().optional(),
  citationRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const sources = await listTrustedKnowledgeSources();
    return success({ sources });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
    const body = patchSchema.parse(await request.json());
    const source = await updateTrustedKnowledgeSource(body);
    return success({ source });
  } catch (error) {
    return handleError(error);
  }
}
