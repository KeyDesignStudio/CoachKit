import { NextRequest } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const uploadsDir = path.join(process.cwd(), 'public', 'uploads');

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
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

    await mkdir(uploadsDir, { recursive: true });

    const ext = path.extname(file.name) || '.png';
    const filename = `${user.id}-${Date.now()}-${randomUUID()}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    await writeFile(filePath, buffer);

    const url = `/uploads/${filename}`;

    return success({ url }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
