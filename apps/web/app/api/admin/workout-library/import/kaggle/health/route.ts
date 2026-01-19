import { randomUUID } from 'crypto';
import path from 'path';
import { NextResponse } from 'next/server';

import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';

function safeUrlInfo(url: string): { urlHost: string; urlPathBasename: string } {
  const parsed = new URL(url);
  return {
    urlHost: parsed.hostname || 'unknown',
    urlPathBasename: path.posix.basename(parsed.pathname || '') || 'unknown',
  };
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const requestId = randomUUID();

  await requireWorkoutLibraryAdmin();

  const url = process.env.KAGGLE_DATA_URL || '';
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        httpStatus: null,
        contentType: null,
        contentLength: null,
        urlHost: null,
        urlPathBasename: null,
        requestId,
      },
      { status: 200 }
    );
  }

  let urlHost = 'unknown';
  let urlPathBasename = 'unknown';
  try {
    const info = safeUrlInfo(url);
    urlHost = info.urlHost;
    urlPathBasename = info.urlPathBasename;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        httpStatus: null,
        contentType: null,
        contentLength: null,
        urlHost: 'invalid-url',
        urlPathBasename: 'invalid-url',
        requestId,
      },
      { status: 200 }
    );
  }

  const accept = 'text/csv,application/csv,application/json;q=0.9,*/*;q=0.8';

  let headStatus: number | null = null;
  let headContentType: string | null = null;
  let headContentLength: number | null = null;

  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD', headers: { accept } }, 15_000);
    headStatus = head.status;
    headContentType = head.headers.get('content-type');
    headContentLength = parseContentLength(head.headers.get('content-length'));
  } catch {
    // HEAD is best-effort; continue to GET.
  }

  let getStatus: number | null = null;
  let getContentType: string | null = null;
  let getContentLength: number | null = null;

  try {
    const get = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          accept,
          range: 'bytes=0-4095',
        },
      },
      30_000
    );

    getStatus = get.status;
    getContentType = get.headers.get('content-type');
    getContentLength = parseContentLength(get.headers.get('content-length'));

    // Avoid downloading a large body as part of a health check.
    try {
      await get.body?.cancel();
    } catch {
      // Ignore.
    }
  } catch {
    // Network error/timeout.
  }

  const httpStatus = getStatus ?? headStatus;
  const contentType = getContentType ?? headContentType;
  const contentLength = getContentLength ?? headContentLength;

  return NextResponse.json(
    {
      ok: Boolean(httpStatus && httpStatus >= 200 && httpStatus < 300),
      httpStatus,
      contentType,
      contentLength,
      urlHost,
      urlPathBasename,
      requestId,
    },
    { status: 200 }
  );
}
