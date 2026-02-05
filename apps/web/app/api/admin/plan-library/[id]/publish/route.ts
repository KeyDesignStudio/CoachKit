import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const planSource = await prisma.planSource.update({
      where: { id: context.params.id },
      data: { isActive: true },
    });

    return success({ planSource });
  } catch (error) {
    return handleError(error);
  }
}
