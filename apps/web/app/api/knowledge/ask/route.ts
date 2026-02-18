import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { askScopedKnowledge } from '@/lib/knowledge/ask';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  query: z.string().trim().min(1, 'Query is required.').max(500, 'Query is too long.'),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const body = bodySchema.parse(await request.json());

    const result = await askScopedKnowledge({
      userId: user.id,
      role: user.role,
      query: body.query,
    });

    return success(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
