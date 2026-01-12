import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { put, del } from '@vercel/blob';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new ApiError(500, 'BLOB_NOT_CONFIGURED', 'Logo uploads require Vercel Blob. Set BLOB_READ_WRITE_TOKEN.');
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      throw new ApiError(400, 'INVALID_FILE', 'file field is required.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new ApiError(400, 'INVALID_FILE', 'Uploaded file is empty.');
    }

    const contentType = typeof file.type === 'string' && file.type.trim() ? file.type : 'application/octet-stream';

    if (!contentType.startsWith('image/')) {
      throw new ApiError(400, 'INVALID_FILE', 'Logo must be an image.');
    }

    const safeExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const objectKey = `coach-logos/${user.id}/${Date.now()}-${randomUUID()}${safeExt}`;

    const blob = await put(objectKey, buffer, {
      access: 'public',
      contentType,
    });

    const updated = await prisma.coachBranding.upsert({
      where: { coachId: user.id },
      update: { logoUrl: blob.url },
      create: {
        coachId: user.id,
        displayName: DEFAULT_BRAND_NAME,
        logoUrl: blob.url,
      },
      select: {
        coachId: true,
        displayName: true,
        logoUrl: true,
      },
    });

    return success({ url: updated.logoUrl, branding: updated }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE() {
  try {
    const { user } = await requireCoach();

    const existing = await prisma.coachBranding.findUnique({
      where: { coachId: user.id },
      select: { logoUrl: true },
    });

    await prisma.coachBranding.upsert({
      where: { coachId: user.id },
      update: { logoUrl: null },
      create: {
        coachId: user.id,
        displayName: DEFAULT_BRAND_NAME,
        logoUrl: null,
      },
      select: { coachId: true },
    });

    if (existing?.logoUrl) {
      try {
        await del(existing.logoUrl);
      } catch {
        // Best-effort cleanup; DB update is the source of truth.
      }
    }

    return success({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
