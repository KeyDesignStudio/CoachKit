import { randomUUID } from 'node:crypto';

import { put } from '@vercel/blob';

function sanitizeFileComponent(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'plan-source';
}

function extensionFromFileName(fileName: string) {
  const match = /\.[a-z0-9]+$/i.exec(fileName);
  return match ? match[0].toLowerCase() : '.pdf';
}

export function planSourceBlobStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function storePlanSourceDocument(params: {
  checksumSha256: string;
  content: Buffer;
  fileName: string;
  contentType: string;
}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  const safeName = sanitizeFileComponent(params.fileName.replace(/\.[^.]+$/, ''));
  const extension = extensionFromFileName(params.fileName);
  const objectKey = `plan-library/${params.checksumSha256}/${Date.now()}-${randomUUID()}-${safeName}${extension}`;

  const blob = await put(objectKey, params.content, {
    access: 'public',
    addRandomSuffix: false,
    contentType: params.contentType || 'application/pdf',
  });

  return {
    url: blob.url,
    key: objectKey,
    contentType: params.contentType || 'application/pdf',
    uploadedAt: new Date(),
  };
}
