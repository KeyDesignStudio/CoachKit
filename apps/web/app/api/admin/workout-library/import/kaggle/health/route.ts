import { randomUUID } from 'crypto';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseBooleanish(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return null;
}

function isKaggleImportEnabled(request: NextRequest): boolean {
  const env = parseBooleanish(process.env.ENABLE_KAGGLE_IMPORT ?? '');
  let enabled = env ?? true;

  // Test-only override: allow Playwright to flip enabled/disabled per-browser-context.
  if (process.env.DISABLE_AUTH === 'true') {
    const cookie = request.cookies.get('coachkit-kaggle-import-enabled')?.value;
    const parsed = cookie ? parseBooleanish(cookie) : null;
    if (parsed !== null) enabled = parsed;
  }

  return enabled;
}

function safeUrlInfo(url: string): { urlHost: string; urlPath: string } {
  const parsed = new URL(url);
  return {
    urlHost: parsed.hostname || 'unknown',
    // Path only; do not include querystring.
    urlPath: parsed.pathname || '/',
  };
}

type ResolvedSource = 'URL' | 'PATH' | 'NONE';

function isVercelRuntime(): boolean {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
}

function resolveSource():
  | { resolvedSource: 'URL'; url: string }
  | { resolvedSource: 'PATH'; filePath: string }
  | { resolvedSource: 'NONE' } {
  const localPath = (process.env.KAGGLE_DATA_PATH || '').trim();
  const url = (process.env.KAGGLE_DATA_URL || '').trim();

  const preferUrl = isVercelRuntime();
  const pickOrder: Array<ResolvedSource> = preferUrl ? ['URL', 'PATH'] : ['PATH', 'URL'];

  for (const source of pickOrder) {
    if (source === 'URL' && url) return { resolvedSource: 'URL', url };
    if (source === 'PATH' && localPath) return { resolvedSource: 'PATH', filePath: localPath };
  }

  return { resolvedSource: 'NONE' };
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseTotalBytesFromContentRange(value: string | null): number | null {
  if (!value) return null;
  // Example: "bytes 0-0/309276123"
  const m = /\/\s*(\d+)\s*$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function getSampleBytesFromEnv(): number {
  const def = 5 * 1024 * 1024;
  const cap = 20 * 1024 * 1024;
  const raw = (process.env.KAGGLE_SAMPLE_BYTES || '').trim();
  if (!raw) return def;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return def;
  return Math.min(Math.max(1024, Math.trunc(parsed)), cap);
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

export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  await requireWorkoutLibraryAdmin();

  if (!isKaggleImportEnabled(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'KAGGLE_DISABLED', message: 'Kaggle import is disabled (ENABLE_KAGGLE_IMPORT=false).' },
        requestId,
      },
      { status: 403 }
    );
  }

  const resolved = resolveSource();
  if (resolved.resolvedSource !== 'URL') {
    return NextResponse.json(
      {
        ok: false,
        resolvedSource: resolved.resolvedSource,
        httpStatus: null,
        headStatus: null,
        rangeProbeStatus: null,
        rangeProbeContentRange: null,
        totalBytes: null,
        sampleBytes: null,
        sampleGetStatus: null,
        sampleBytesFetched: null,
        contentType: null,
        contentLength: null,
        urlHost: null,
        urlPath: null,
        requestId,
      },
      { status: 200 }
    );
  }

  const url = resolved.url;

  let urlHost = 'unknown';
  let urlPath = '/';
  try {
    const info = safeUrlInfo(url);
    urlHost = info.urlHost;
    urlPath = info.urlPath;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        resolvedSource: 'URL',
        httpStatus: null,
        headStatus: null,
        rangeProbeStatus: null,
        rangeProbeContentRange: null,
        totalBytes: null,
        sampleBytes: null,
        sampleGetStatus: null,
        sampleBytesFetched: null,
        contentType: null,
        contentLength: null,
        urlHost: 'invalid-url',
        urlPath: 'invalid-url',
        requestId,
      },
      { status: 200 }
    );
  }

  const accept = 'text/csv,application/csv,application/json;q=0.9,*/*;q=0.8';
  const sampleBytes = getSampleBytesFromEnv();

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

  // Range probe (bytes=0-0).
  let rangeProbeStatus: number | null = null;
  let rangeProbeContentRange: string | null = null;
  let totalBytes: number | null = null;
  try {
    const probe = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          accept,
          range: 'bytes=0-0',
        },
      },
      15_000
    );
    rangeProbeStatus = probe.status;
    rangeProbeContentRange = probe.headers.get('content-range');
    totalBytes = parseTotalBytesFromContentRange(rangeProbeContentRange);
    try {
      await probe.body?.cancel();
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }

  // Sample GET (single range) using the same sample size as the real loader.
  let sampleGetStatus: number | null = null;
  let sampleBytesFetched: number | null = null;
  let sampleContentType: string | null = null;
  let sampleContentLength: number | null = null;
  try {
    const get = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          accept,
          range: `bytes=0-${Math.max(0, sampleBytes - 1)}`,
        },
      },
      60_000
    );

    sampleGetStatus = get.status;
    sampleContentType = get.headers.get('content-type');
    sampleContentLength = parseContentLength(get.headers.get('content-length'));

    // Consume at most the sampled body.
    const text = await get.text();
    sampleBytesFetched = Buffer.byteLength(text, 'utf8');
  } catch {
    // ignore
  }

  const httpStatus = sampleGetStatus ?? rangeProbeStatus ?? headStatus;
  const contentType = sampleContentType ?? headContentType;
  const contentLength = sampleContentLength ?? headContentLength;

  return NextResponse.json(
    {
      ok: Boolean(httpStatus && httpStatus >= 200 && httpStatus < 300),
      resolvedSource: 'URL',
      httpStatus,
      headStatus,
      rangeProbeStatus,
      rangeProbeContentRange,
      totalBytes,
      sampleBytes,
      sampleGetStatus,
      sampleBytesFetched,
      contentType,
      contentLength,
      urlHost,
      urlPath,
      requestId,
    },
    { status: 200 }
  );
}
