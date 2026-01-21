import Papa from 'papaparse';

import { ApiError } from '@/lib/errors';

const DEFAULT_PLANS_URL =
  'https://brybh56rmr6bijrr.public.blob.vercel-storage.com/Workout_Library/plans_catalog_metric.csv';
const DEFAULT_SESSIONS_URL =
  'https://brybh56rmr6bijrr.public.blob.vercel-storage.com/Workout_Library/sessions_library_metric_enriched.csv';
const DEFAULT_SCHEDULE_URL =
  'https://brybh56rmr6bijrr.public.blob.vercel-storage.com/Workout_Library/plan_schedule_metric.csv';

export type PlanLibraryDataset = 'PLANS' | 'SESSIONS' | 'SCHEDULE';

export function getPlanLibraryDatasetUrl(dataset: PlanLibraryDataset): string {
  if (dataset === 'PLANS') return process.env.PLAN_LIBRARY_PLANS_URL || DEFAULT_PLANS_URL;
  if (dataset === 'SESSIONS') return process.env.PLAN_LIBRARY_SESSIONS_URL || DEFAULT_SESSIONS_URL;
  return process.env.PLAN_LIBRARY_SCHEDULE_URL || DEFAULT_SCHEDULE_URL;
}

export function sanitizeUrlForLogs(url: string): { urlHost: string; urlPath: string; resolvedSource: string } {
  const parsed = new URL(url);
  return {
    urlHost: parsed.host,
    urlPath: parsed.pathname,
    resolvedSource: `${parsed.host}${parsed.pathname}`,
  };
}

export async function headWithTimeout(
  url: string,
  opts: { timeoutMs: number }
): Promise<{ status: number; ok: boolean; contentType: string | null; contentLength: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type');
    const lengthRaw = res.headers.get('content-length');
    const contentLength = lengthRaw ? Number(lengthRaw) : null;

    return {
      status: res.status,
      ok: res.ok,
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTextWithTimeoutAndLimit(
  url: string,
  opts: { timeoutMs: number; maxBytes: number }
): Promise<{ text: string; contentType: string | null; contentLength: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' },
    });

    if (!res.ok) {
      throw new ApiError(502, 'FETCH_FAILED', `Failed to fetch dataset: ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type');
    const lengthRaw = res.headers.get('content-length');
    const contentLength = lengthRaw ? Number(lengthRaw) : null;

    if (Number.isFinite(contentLength) && contentLength != null && contentLength > opts.maxBytes) {
      throw new ApiError(413, 'DATASET_TOO_LARGE', `Dataset content-length exceeds limit (${opts.maxBytes} bytes).`);
    }

    // Stream into a bounded buffer to avoid loading unbounded content into memory.
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      if (text.length > opts.maxBytes) {
        throw new ApiError(413, 'DATASET_TOO_LARGE', `Dataset exceeds limit (${opts.maxBytes} bytes).`);
      }
      return {
        text,
        contentType,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
      };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > opts.maxBytes) {
        try {
          controller.abort();
        } catch {
          // no-op
        }
        throw new ApiError(413, 'DATASET_TOO_LARGE', `Dataset exceeds limit (${opts.maxBytes} bytes).`);
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder('utf-8').decode(merged);

    return {
      text,
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseCsvObjects(text: string): Array<Record<string, unknown>> {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });

  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new ApiError(400, 'CSV_PARSE_ERROR', first?.message ?? 'Failed to parse CSV.', {
      row: first?.row,
      type: first?.type,
      code: first?.code,
    });
  }

  return (parsed.data ?? []).map((row) => row ?? {});
}

export function parseBoolean(raw: unknown): boolean {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return false;
  if (text === 'true' || text === 't' || text === '1' || text === 'yes' || text === 'y') return true;
  return false;
}

export function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const text = String(raw).trim();
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function asTrimmedString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  return String(raw).trim();
}

export function parseJsonOrNull(raw: unknown): unknown | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw as any;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
