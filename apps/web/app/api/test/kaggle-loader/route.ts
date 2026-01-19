import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { handleError, success } from '@/lib/http';
import { fetchKaggleTableFromUrl } from '@/lib/ingestion/kaggle';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  url: z.string().url(),
});

export async function POST(request: NextRequest) {
  // Test-only endpoint.
  if (process.env.DISABLE_AUTH !== 'true') {
    return new Response('not found', { status: 404 });
  }

  const requestId = randomUUID();
  try {
    const body = bodySchema.parse(await request.json());
    const table = await fetchKaggleTableFromUrl(body.url, { requestId });

    return success({
      ok: true,
      format: table.format,
      rowCount: table.rows.length,
    });
  } catch (error) {
    return handleError(error, { requestId, where: 'POST /api/test/kaggle-loader' });
  }
}
