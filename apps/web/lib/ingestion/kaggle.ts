import { readFile } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';
import Papa from 'papaparse';

import { normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';
import { ApiError } from '@/lib/errors';

export type KaggleNormalizedItem = {
  title: string;
  discipline: WorkoutLibraryDiscipline;
  tags: string[];
  description: string;
  durationSec?: number;
  intensityTarget: string;
  distanceMeters?: number | null;
  elevationGainMeters?: number | null;
  notes?: string | null;
  equipment: string[];
  workoutStructure?: unknown | null;
};

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload as unknown[];

  const obj = payload as Record<string, unknown>;
  const candidate = obj?.items ?? obj?.rows ?? obj?.data;
  if (Array.isArray(candidate)) return candidate as unknown[];

  throw new Error('Kaggle payload must be an array or { items/rows/data: [...] }.');
}

type KaggleDatasetFormat = 'csv' | 'json';

type KaggleCsvRangeDiagnostics = {
  scannedRows: number;
  returnedRows: number;
  bytesFetchedTotal: number;
  rangeRequests: number;
  contentType: string | null;
  contentLength: number | null;
  usedRange: boolean;
  warning?: string;
};

type KaggleFetchStep = 'HEAD' | 'RANGE_GET' | 'PARSE' | 'VALIDATE';

function detectFormatFromPathOrUrl(value: string): KaggleDatasetFormat | null {
  const lower = value.trim().toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

function detectFormatFromContentType(contentType: string | null | undefined): KaggleDatasetFormat | null {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/csv') || ct.includes('application/csv') || ct.includes('text/plain')) return 'csv';
  if (ct.includes('application/json')) return 'json';
  return null;
}

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const anyErr = error as any;
  const name = String(anyErr.name || '');
  if (name === 'AbortError') return true;
  const msg = String(anyErr.message || '');
  return msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('operation was aborted');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function parseCsvRows(text: string, options?: { requestId?: string }): Array<Record<string, string>> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors && parsed.errors.length > 0) {
    const top = parsed.errors.slice(0, 3).map((e) => {
      const row = typeof e.row === 'number' ? e.row : undefined;
      const code = e.code ? String(e.code) : undefined;
      const message = e.message ? String(e.message) : 'CSV parse error.';
      return { ...(row !== undefined ? { row } : {}), ...(code ? { code } : {}), message };
    });
    const rowCount = Array.isArray(parsed.data) ? parsed.data.length : 0;
    throw new ApiError(
      400,
      'KAGGLE_PARSE_FAILED',
      `Failed to parse Kaggle dataset CSV (format=csv, rows=${rowCount}, errors=${JSON.stringify(top)}).` +
        (options?.requestId ? ` (requestId=${options.requestId})` : '')
    );
  }

  const rows = (parsed.data ?? []).filter((row) => row && typeof row === 'object') as Array<Record<string, string>>;
  return rows;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function findLastNewlineOutsideQuotes(text: string): number {
  let inQuotes = false;
  let lastSafe = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // CSV escape: doubled quote inside quoted field.
      if (inQuotes && text[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === '\n') {
      lastSafe = i;
    }
  }

  return lastSafe;
}

function parseCsvChunkWithHeader(
  chunk: string,
  state: { header: string[] | null },
  options?: { requestId?: string; urlHost?: string; urlPath?: string }
): Array<Record<string, string>> {
  const text = chunk.replace(/^\uFEFF/, '');

  if (!state.header) {
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    if (parsed.errors && parsed.errors.length > 0) {
      const top = parsed.errors.slice(0, 3).map((e) => ({
        row: typeof e.row === 'number' ? e.row : undefined,
        code: e.code ? String(e.code) : undefined,
        message: e.message ? String(e.message) : 'CSV parse error.',
      }));
      throw new ApiError(
        400,
        'KAGGLE_PARSE_FAILED',
        `Failed to parse Kaggle dataset CSV header (errors=${JSON.stringify(top)}).` +
          (options?.requestId ? ` (requestId=${options.requestId})` : ''),
        {
          step: 'PARSE' satisfies KaggleFetchStep,
          ...(options?.urlHost ? { urlHost: options.urlHost } : {}),
          ...(options?.urlPath ? { urlPath: options.urlPath } : {}),
        }
      );
    }

    const rows = (parsed.data ?? []).filter((r) => Array.isArray(r) && r.some((v) => String(v ?? '').trim().length > 0)) as string[][];
    if (rows.length === 0) return [];
    state.header = rows[0].map((h) => String(h ?? '').trim());
    const dataRows = rows.slice(1);
    return dataRows.map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < state.header!.length; i++) {
        const key = state.header![i] || `col_${i}`;
        obj[key] = row[i] === null || row[i] === undefined ? '' : String(row[i]);
      }
      return obj;
    });
  }

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors && parsed.errors.length > 0) {
    const top = parsed.errors.slice(0, 3).map((e) => ({
      row: typeof e.row === 'number' ? e.row : undefined,
      code: e.code ? String(e.code) : undefined,
      message: e.message ? String(e.message) : 'CSV parse error.',
    }));
    throw new ApiError(
      400,
      'KAGGLE_PARSE_FAILED',
      `Failed to parse Kaggle dataset CSV chunk (errors=${JSON.stringify(top)}).` +
        (options?.requestId ? ` (requestId=${options.requestId})` : ''),
      {
        step: 'PARSE' satisfies KaggleFetchStep,
        ...(options?.urlHost ? { urlHost: options.urlHost } : {}),
        ...(options?.urlPath ? { urlPath: options.urlPath } : {}),
      }
    );
  }

  const out: Array<Record<string, string>> = [];
  const rows = (parsed.data ?? []).filter((r) => Array.isArray(r) && r.some((v) => String(v ?? '').trim().length > 0)) as string[][];
  for (const row of rows) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < state.header.length; i++) {
      const key = state.header[i] || `col_${i}`;
      obj[key] = row[i] === null || row[i] === undefined ? '' : String(row[i]);
    }
    out.push(obj);
  }
  return out;
}

export async function loadKaggleRowsCsvRange(options: {
  url: string;
  offset: number;
  maxRows: number;
  maxBytesPerRequest?: number;
  requestId?: string;
}): Promise<{ rows: Array<Record<string, string>>; diagnostics: KaggleCsvRangeDiagnostics; urlHost: string; urlPath: string }> {
  const { host: urlHost } = safeUrlInfo(options.url);
  const parsedUrl = new URL(options.url);
  const urlPath = parsedUrl.pathname || '/';

  const requestId = options.requestId;
  const maxBytesPerRequest = Math.max(64 * 1024, Math.min(options.maxBytesPerRequest ?? 2 * 1024 * 1024, 8 * 1024 * 1024));

  // HEAD: gather content-type/length for guards.
  let headStatus: number | null = null;
  let contentType: string | null = null;
  let contentLength: number | null = null;
  try {
    const head = await fetchWithTimeout(
      options.url,
      {
        method: 'HEAD',
        cache: 'no-store',
        headers: { accept: 'text/csv,application/csv,text/plain;q=0.9,*/*;q=0.8' },
      },
      10_000
    );
    headStatus = head.status;
    contentType = head.headers.get('content-type');
    contentLength = parseContentLength(head.headers.get('content-length'));
  } catch (error) {
    // Continue; HEAD is best-effort.
    if (isAbortLikeError(error)) {
      // Make abort visible, but don't block if GET works.
      headStatus = null;
    }
  }

  const diagnostics: KaggleCsvRangeDiagnostics = {
    scannedRows: 0,
    returnedRows: 0,
    bytesFetchedTotal: 0,
    rangeRequests: 0,
    contentType,
    contentLength,
    usedRange: true,
    ...(contentLength !== null && contentLength > 100 * 1024 * 1024
      ? { warning: `contentLength=${contentLength} (>100MB). Range mode enabled; dry-run will stop early.` }
      : {}),
  };

  const offset = Math.max(0, Math.trunc(options.offset));
  const maxRows = Math.max(1, Math.trunc(options.maxRows));
  const targetScanned = offset + maxRows;

  let byteStart = 0;
  let carry = '';
  const state: { header: string[] | null } = { header: null };
  const rowsOut: Array<Record<string, string>> = [];

  // Loop over range GETs until we have enough rows (offset+maxRows) or EOF.
  while (diagnostics.scannedRows < targetScanned) {
    const byteEnd = byteStart + maxBytesPerRequest - 1;

    let res: Response | null = null;
    let attempt = 0;
    const backoffs = [250, 750];
    while (attempt < 3) {
      attempt++;
      try {
        diagnostics.rangeRequests++;
        const candidate = await fetchWithTimeout(
          options.url,
          {
            method: 'GET',
            cache: 'no-store',
            headers: {
              accept: 'text/csv,application/csv,text/plain;q=0.9,*/*;q=0.8',
              range: `bytes=${byteStart}-${byteEnd}`,
            },
          },
          15_000
        );

        // Retry transient gateway errors.
        if (isTransientStatus(candidate.status) && attempt < 3) {
          await sleep(backoffs[Math.min(attempt - 1, backoffs.length - 1)]);
          continue;
        }

        res = candidate;
        break;
      } catch (error) {
        const transient = isAbortLikeError(error);
        if (transient && attempt < 3) {
          await sleep(backoffs[Math.min(attempt - 1, backoffs.length - 1)]);
          continue;
        }
        throw new ApiError(
          502,
          'KAGGLE_FETCH_FAILED',
          `Failed to fetch Kaggle dataset range (host=${urlHost}, error=${(error as any)?.message || 'network error'}).` +
            (requestId ? ` (requestId=${requestId})` : ''),
          { urlHost, urlPath, step: 'RANGE_GET' satisfies KaggleFetchStep }
        );
      }
    }

    if (!res) {
      throw new ApiError(
        502,
        'KAGGLE_FETCH_FAILED',
        `Failed to fetch Kaggle dataset range (host=${urlHost}).` + (requestId ? ` (requestId=${requestId})` : ''),
        { urlHost, urlPath, step: 'RANGE_GET' satisfies KaggleFetchStep }
      );
    }

    // EOF.
    if (res.status === 416) break;

    // If the server ignored Range and returned 200, only allow small fallback.
    if (res.status === 200) {
      diagnostics.usedRange = false;
      if (contentLength !== null && contentLength <= 5 * 1024 * 1024) {
        const text = await res.text();
        diagnostics.bytesFetchedTotal += Buffer.byteLength(text, 'utf8');
        const safeCut = findLastNewlineOutsideQuotes(text);
        const parseable = safeCut >= 0 ? text.slice(0, safeCut + 1) : text;
        const parsedRows = parseCsvChunkWithHeader(parseable, state, { requestId, urlHost, urlPath });
        for (const r of parsedRows) {
          diagnostics.scannedRows++;
          if (diagnostics.scannedRows > offset && rowsOut.length < maxRows) rowsOut.push(r);
        }
        break;
      }

      throw new ApiError(
        400,
        'KAGGLE_RANGE_UNSUPPORTED',
        `Server does not support Range requests for Kaggle CSV (host=${urlHost}).` +
          (requestId ? ` (requestId=${requestId})` : ''),
        { urlHost, urlPath, step: 'RANGE_GET' satisfies KaggleFetchStep }
      );
    }

    if (!res.ok && res.status !== 206) {
      throw new ApiError(
        502,
        'KAGGLE_FETCH_FAILED',
        `Failed to fetch Kaggle dataset range (host=${urlHost}, status=${res.status}${res.statusText ? `, statusText=${res.statusText}` : ''}).` +
          (requestId ? ` (requestId=${requestId})` : ''),
        { urlHost, urlPath, step: 'RANGE_GET' satisfies KaggleFetchStep }
      );
    }

    const chunkText = await res.text();
    diagnostics.bytesFetchedTotal += Buffer.byteLength(chunkText, 'utf8');
    carry += chunkText;

    const safeCut = findLastNewlineOutsideQuotes(carry);
    if (safeCut >= 0) {
      const parseable = carry.slice(0, safeCut + 1);
      carry = carry.slice(safeCut + 1);

      const parsedRows = parseCsvChunkWithHeader(parseable, state, { requestId, urlHost, urlPath });
      for (const r of parsedRows) {
        diagnostics.scannedRows++;
        if (diagnostics.scannedRows > offset && rowsOut.length < maxRows) {
          rowsOut.push(r);
        }
        if (diagnostics.scannedRows >= targetScanned) break;
      }
    }

    // Advance range window.
    byteStart = byteEnd + 1;

    // If we got an empty body, stop to avoid infinite loop.
    if (!chunkText) break;
  }

  diagnostics.returnedRows = rowsOut.length;
  return { rows: rowsOut, diagnostics, urlHost, urlPath };
}

function coerceCsvRowObject(row: unknown): Record<string, string> {
  if (!row || typeof row !== 'object') return {};
  const obj = row as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    out[key] = value === null || value === undefined ? '' : String(value);
  }
  return out;
}

export type KaggleFetchedTable = {
  format: KaggleDatasetFormat;
  rows: Array<Record<string, string>>;
  diagnostics?: KaggleCsvRangeDiagnostics;
};

function isVercelRuntime(): boolean {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
}

function safeBasename(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const base = path.posix.basename(normalized);
  return base || 'unknown';
}

function safeUrlInfo(url: string): { host: string; pathBase: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || 'unknown';
    const pathBase = path.posix.basename(parsed.pathname || '') || 'unknown';
    return { host, pathBase };
  } catch {
    throw new ApiError(400, 'KAGGLE_URL_INVALID', 'KAGGLE_DATA_URL is not a valid URL.');
  }
}

export async function fetchKaggleTableFromUrl(
  url: string,
  options?: { requestId?: string; offsetRows?: number; maxRows?: number }
): Promise<KaggleFetchedTable> {
  const requestId = options?.requestId;
  const { host, pathBase } = safeUrlInfo(url);
  const urlPath = new URL(url).pathname || '/';

  const formatFromUrl = detectFormatFromPathOrUrl(url);

  // If URL suffix indicates CSV, go straight to Range loading.
  if (formatFromUrl === 'csv') {
    const offsetRows = Math.max(0, Math.trunc(options?.offsetRows ?? 0));
    const maxRows = Math.max(1, Math.trunc(options?.maxRows ?? 200));
    const ranged = await loadKaggleRowsCsvRange({ url, offset: offsetRows, maxRows, requestId });
    return { format: 'csv', rows: ranged.rows.map(coerceCsvRowObject), diagnostics: ranged.diagnostics };
  }

  // If URL suffix indicates JSON, use a normal GET.
  if (formatFromUrl === 'json') {
    // fall through to JSON loader
  }

  // Otherwise, determine format using best-effort HEAD.
  let headContentType: string | null = null;
  try {
    const head = await fetchWithTimeout(
      url,
      {
        method: 'HEAD',
        cache: 'no-store',
        headers: { accept: 'text/csv,application/csv,application/json;q=0.9,*/*;q=0.8' },
      },
      10_000
    );
    headContentType = head.headers.get('content-type');
  } catch {
    // ignore
  }

  const formatFromContentType = detectFormatFromContentType(headContentType);
  const format = formatFromUrl ?? formatFromContentType;

  if (format === 'csv') {
    const offsetRows = Math.max(0, Math.trunc(options?.offsetRows ?? 0));
    const maxRows = Math.max(1, Math.trunc(options?.maxRows ?? 200));
    const ranged = await loadKaggleRowsCsvRange({ url, offset: offsetRows, maxRows, requestId });
    return { format: 'csv', rows: ranged.rows.map(coerceCsvRowObject), diagnostics: ranged.diagnostics };
  }

  if (format !== 'json') {
    throw new ApiError(
      400,
      'KAGGLE_UNSUPPORTED_FORMAT',
      `Unsupported Kaggle dataset format (host=${host}, file=${pathBase}). Expected CSV or JSON.` +
        (requestId ? ` (requestId=${requestId})` : ''),
      { urlHost: host, urlPath, step: 'VALIDATE' satisfies KaggleFetchStep }
    );
  }

  // JSON GET.
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        cache: 'no-store',
        headers: { accept: 'application/json,*/*;q=0.8' },
      },
      30_000
    );
  } catch (error) {
    const err = error as any;
    throw new ApiError(
      502,
      'KAGGLE_FETCH_FAILED',
      `Failed to fetch Kaggle dataset (host=${host}, error=${err?.message || 'network error'}).` +
        (requestId ? ` (requestId=${requestId})` : ''),
      { urlHost: host, urlPath, step: 'RANGE_GET' satisfies KaggleFetchStep }
    );
  }

  if (!res.ok) {
    throw new ApiError(
      502,
      'KAGGLE_FETCH_FAILED',
      `Failed to fetch Kaggle dataset (host=${host}, status=${res.status}${res.statusText ? `, statusText=${res.statusText}` : ''}).` +
        (requestId ? ` (requestId=${requestId})` : ''),
      { urlHost: host, urlPath, step: 'RANGE_GET' satisfies KaggleFetchStep }
    );
  }

  // JSON
  let parsed: unknown;
  try {
    parsed = (await res.json()) as unknown;
  } catch (error) {
    console.error('[workout-library][kaggle] Parse failed (URL JSON)', {
      requestId,
      host,
      pathBase,
      error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
    });
    throw new ApiError(
      400,
      'KAGGLE_PARSE_FAILED',
      `Failed to parse Kaggle dataset JSON (format=json, host=${host}).` + (requestId ? ` (requestId=${requestId})` : ''),
      { urlHost: host, urlPath, step: 'PARSE' satisfies KaggleFetchStep }
    );
  }

  try {
    return { format: 'json', rows: extractRows(parsed).map(coerceCsvRowObject) };
  } catch (error) {
    console.error('[workout-library][kaggle] Invalid payload shape (URL JSON)', {
      requestId,
      host,
      pathBase,
      error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
    });
    throw new ApiError(
      400,
      'KAGGLE_PARSE_FAILED',
      `Kaggle dataset JSON has an unexpected shape (format=json, host=${host}).` +
        (requestId ? ` (requestId=${requestId})` : ''),
      { urlHost: host, urlPath, step: 'VALIDATE' satisfies KaggleFetchStep }
    );
  }
}

export async function fetchKaggleRows(options?: { requestId?: string }): Promise<unknown[]> {
  const requestId = options?.requestId;

  const localPath = process.env.KAGGLE_DATA_PATH || '';
  const url = process.env.KAGGLE_DATA_URL || '';

  const preferUrl = isVercelRuntime();
  const pickOrder: Array<'URL' | 'PATH'> = preferUrl ? ['URL', 'PATH'] : ['PATH', 'URL'];

  for (const source of pickOrder) {
    if (source === 'URL' && url) {
      const { host, pathBase } = safeUrlInfo(url);
      console.info('[workout-library][kaggle] Kaggle source = URL', { requestId, host, pathBase });
      const table = await fetchKaggleTableFromUrl(url, { requestId });
      return table.rows;
    }

    if (source === 'PATH' && localPath) {
      const resolved = path.isAbsolute(localPath) ? localPath : path.join(process.cwd(), localPath);
      const fileBase = safeBasename(resolved);
      console.info('[workout-library][kaggle] Kaggle source = PATH', { requestId, fileBase });

      let text: string;
      try {
        text = await readFile(resolved, 'utf8');
      } catch (error) {
        console.error('[workout-library][kaggle] Read failed (PATH)', {
          requestId,
          fileBase,
          error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
        });
        throw new ApiError(400, 'KAGGLE_READ_FAILED', `Failed to read Kaggle dataset file (${fileBase}).`);
      }

      const format = detectFormatFromPathOrUrl(resolved);
      if (!format) {
        throw new ApiError(400, 'KAGGLE_UNSUPPORTED_FORMAT', `Unsupported Kaggle dataset format (${fileBase}). Expected .csv or .json.`);
      }

      if (format === 'csv') {
        return parseCsvRows(text, { requestId }).map(coerceCsvRowObject);
      }

      // JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        console.error('[workout-library][kaggle] Parse failed (PATH JSON)', {
          requestId,
          fileBase,
          error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
        });
        throw new ApiError(400, 'KAGGLE_PARSE_FAILED', `Failed to parse Kaggle dataset JSON (format=json, file=${fileBase}).`);
      }

      try {
        return extractRows(parsed);
      } catch (error) {
        console.error('[workout-library][kaggle] Invalid payload shape (PATH JSON)', {
          requestId,
          fileBase,
          error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
        });
        throw new ApiError(400, 'KAGGLE_PARSE_FAILED', `Kaggle dataset JSON has an unexpected shape (format=json, file=${fileBase}).`);
      }
    }
  }

  // Not configured.
  throw new ApiError(
    400,
    'KAGGLE_NOT_CONFIGURED',
    preferUrl
      ? 'Kaggle dataset not configured. Set KAGGLE_DATA_URL (Vercel) or KAGGLE_DATA_PATH (local/dev/tests).'
      : 'Kaggle dataset not configured. Set KAGGLE_DATA_PATH (local/dev/tests) or KAGGLE_DATA_URL.'
  );
}

export async function fetchKaggleTable(options?: {
  requestId?: string;
  offsetRows?: number;
  maxRows?: number;
}): Promise<KaggleFetchedTable> {
  const requestId = options?.requestId;
  const offsetRows = Math.max(0, Math.trunc(options?.offsetRows ?? 0));
  const maxRows = Math.max(1, Math.trunc(options?.maxRows ?? 200));

  const localPath = process.env.KAGGLE_DATA_PATH || '';
  const url = process.env.KAGGLE_DATA_URL || '';

  const preferUrl = isVercelRuntime();
  const pickOrder: Array<'URL' | 'PATH'> = preferUrl ? ['URL', 'PATH'] : ['PATH', 'URL'];

  for (const source of pickOrder) {
    if (source === 'URL' && url) {
      const { host, pathBase } = safeUrlInfo(url);
      console.info('[workout-library][kaggle] Kaggle source = URL', { requestId, host, pathBase });
      return await fetchKaggleTableFromUrl(url, { requestId, offsetRows, maxRows });
    }

    if (source === 'PATH' && localPath) {
      const resolved = path.isAbsolute(localPath) ? localPath : path.join(process.cwd(), localPath);
      const fileBase = safeBasename(resolved);
      console.info('[workout-library][kaggle] Kaggle source = PATH', { requestId, fileBase });

      let text: string;
      try {
        text = await readFile(resolved, 'utf8');
      } catch (error) {
        console.error('[workout-library][kaggle] Read failed (PATH)', {
          requestId,
          fileBase,
          error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
        });
        throw new ApiError(400, 'KAGGLE_READ_FAILED', `Failed to read Kaggle dataset file (${fileBase}).`);
      }

      const format = detectFormatFromPathOrUrl(resolved);
      if (!format) {
        throw new ApiError(400, 'KAGGLE_UNSUPPORTED_FORMAT', `Unsupported Kaggle dataset format (${fileBase}). Expected .csv or .json.`);
      }

      if (format === 'csv') {
        const all = parseCsvRows(text, { requestId }).map(coerceCsvRowObject);
        const sliced = all.slice(offsetRows, offsetRows + maxRows);
        return {
          format: 'csv',
          rows: sliced,
          diagnostics: {
            scannedRows: all.length,
            returnedRows: sliced.length,
            bytesFetchedTotal: Buffer.byteLength(text, 'utf8'),
            rangeRequests: 0,
            contentType: 'text/csv',
            contentLength: Buffer.byteLength(text, 'utf8'),
            usedRange: false,
          },
        };
      }

      // JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        console.error('[workout-library][kaggle] Parse failed (PATH JSON)', {
          requestId,
          fileBase,
          error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
        });
        throw new ApiError(400, 'KAGGLE_PARSE_FAILED', `Failed to parse Kaggle dataset JSON (format=json, file=${fileBase}).`);
      }

      const rows = extractRows(parsed).map(coerceCsvRowObject);
      return { format: 'json', rows: rows.slice(offsetRows, offsetRows + maxRows) };
    }
  }

  throw new ApiError(
    400,
    'KAGGLE_NOT_CONFIGURED',
    preferUrl
      ? 'Kaggle dataset not configured. Set KAGGLE_DATA_URL (Vercel) or KAGGLE_DATA_PATH (local/dev/tests).'
      : 'Kaggle dataset not configured. Set KAGGLE_DATA_PATH (local/dev/tests) or KAGGLE_DATA_URL.'
  );
}

type RowError = { index: number; message: string };

export type KaggleProgramImportSummary = {
  scannedGroups: number;
  createdGroups: number;
  skippedDuplicateGroups: number;
  skippedInvalidTitleGroups: number;
  errors: RowError[];
};

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function asNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function splitEquipmentList(value: unknown): string[] {
  const text = asString(value).trim();
  if (!text) return [];
  return text
    .split(/[;,]/)
    .map((v) => collapseWhitespace(v))
    .filter(Boolean);
}

function normalizeIntensityTarget(value: unknown): string {
  const raw = collapseWhitespace(asString(value));
  if (!raw) return 'Controlled';
  const maybeNum = Number(raw);
  if (Number.isFinite(maybeNum) && raw.match(/^\d+(\.\d+)?$/)) {
    // Keep the original integer-ish string if possible.
    const asInt = Number.isInteger(maybeNum) ? String(Math.trunc(maybeNum)) : String(maybeNum);
    return `RPE ${asInt}`;
  }
  return raw;
}

function normalizeReps(value: unknown): number | string | null {
  const raw = collapseWhitespace(asString(value));
  if (!raw) return null;

  const maybeNum = Number(raw);
  if (Number.isFinite(maybeNum) && raw.match(/^-?\d+(\.\d+)?$/)) {
    const asInt = Math.trunc(maybeNum);
    if (asInt <= 0) return null;
    return asInt;
  }

  return raw;
}

function normalizeSets(value: unknown): number | null {
  const raw = collapseWhitespace(asString(value));
  if (!raw) return null;
  const maybeNum = Number(raw);
  if (!Number.isFinite(maybeNum)) return null;
  const asInt = Math.trunc(maybeNum);
  if (asInt <= 0) return null;
  return asInt;
}

function buildProgramDayDescription(params: {
  description: string;
  goal: string;
  level: string;
  equipment: string;
  programLength: string;
  timePerWorkout: string;
}): string {
  const lines: string[] = [];

  if (params.description) lines.push(params.description);

  const metaBits = [
    params.goal ? `Goal: ${params.goal}` : '',
    params.level ? `Level: ${params.level}` : '',
    params.equipment ? `Equipment: ${params.equipment}` : '',
  ].filter(Boolean);

  if (metaBits.length) {
    if (lines.length) lines.push('');
    lines.push(metaBits.join(' | '));
  }

  const programBits = [
    params.programLength ? `Program length: ${params.programLength} weeks` : '',
    params.timePerWorkout ? `Time per workout: ${params.timePerWorkout} min` : '',
  ].filter(Boolean);

  if (programBits.length) {
    if (lines.length) lines.push('');
    lines.push(programBits.join(' | '));
  }

  return lines.join('\n');
}

export function buildKaggleProgramTemplates(rows: Array<Record<string, string>>, options: { maxGroups: number; offsetGroups: number }): {
  items: Array<{
    title: string;
    titleKey: string;
    discipline: WorkoutLibraryDiscipline;
    tags: string[];
    description: string;
    durationSec: number;
    intensityTarget: string;
    equipment: string[];
    workoutStructure: unknown;
  }>;
  summary: KaggleProgramImportSummary;
} {
  const errors: RowError[] = [];

  // Group rows: each row represents a single exercise in a program day.
  const grouped = new Map<string, Array<{ row: Record<string, string>; orderKey: string }>>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const baseTitle = collapseWhitespace(asString(r.title));
    const week = collapseWhitespace(asString(r.week));
    const day = collapseWhitespace(asString(r.day));
    const groupKey = `${baseTitle}::week${week || '?'}::day${day || '?'}`;

    const exerciseName = collapseWhitespace(asString(r.exercise_name));
    const sets = collapseWhitespace(asString(r.sets));
    const reps = collapseWhitespace(asString(r.reps));
    const intensity = collapseWhitespace(asString(r.intensity));
    const orderKey = [exerciseName.toLowerCase(), sets, reps, intensity, String(i).padStart(8, '0')].join('|');

    const arr = grouped.get(groupKey) ?? [];
    arr.push({ row: r, orderKey });
    grouped.set(groupKey, arr);
  }

  const allGroupKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  const slicedKeys = allGroupKeys.slice(options.offsetGroups, options.offsetGroups + options.maxGroups);

  let skippedInvalidTitleGroups = 0;
  const items: Array<{
    title: string;
    titleKey: string;
    discipline: WorkoutLibraryDiscipline;
    tags: string[];
    description: string;
    durationSec: number;
    intensityTarget: string;
    equipment: string[];
    workoutStructure: unknown;
  }> = [];

  for (let g = 0; g < slicedKeys.length; g++) {
    const key = slicedKeys[g];
    const rowsInGroup = grouped.get(key) ?? [];
    if (rowsInGroup.length === 0) continue;

    const first = rowsInGroup[0].row;
    const baseTitle = collapseWhitespace(asString(first.title));
    if (!baseTitle) {
      skippedInvalidTitleGroups++;
      continue;
    }

    const week = collapseWhitespace(asString(first.week)) || '?';
    const day = collapseWhitespace(asString(first.day)) || '?';

    const goal = collapseWhitespace(asString(first.goal));
    const level = collapseWhitespace(asString(first.level));
    const equipmentRaw = collapseWhitespace(asString(first.equipment));
    const programLength = collapseWhitespace(asString(first.program_length));
    const timePerWorkout = collapseWhitespace(asString(first.time_per_workout));

    const durationMinutes = asNumber(timePerWorkout);
    const durationSec = durationMinutes && durationMinutes > 0 ? Math.round(durationMinutes * 60) : 0;

    const intensityTarget = normalizeIntensityTarget(first.intensity);

    const tags = normalizeTags(
      [
        goal,
        level,
        ...splitEquipmentList(equipmentRaw),
        `Week ${week}`,
        `Day ${day}`,
      ].filter(Boolean)
    );

    const equipment = normalizeEquipment(splitEquipmentList(equipmentRaw));

    const description = buildProgramDayDescription({
      description: collapseWhitespace(asString(first.description)),
      goal,
      level,
      equipment: equipmentRaw,
      programLength,
      timePerWorkout,
    });

    // Stable ordering: deterministic sort.
    const sorted = [...rowsInGroup].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    const segments = sorted
      .map(({ row }) => {
        const name = collapseWhitespace(asString(row.exercise_name));
        if (!name) return null;

        const sets = normalizeSets(row.sets);
        const reps = normalizeReps(row.reps);
        const intensity = normalizeIntensityTarget(row.intensity);

        return {
          type: 'exercise',
          name,
          ...(sets != null ? { sets } : {}),
          ...(reps != null ? { reps } : {}),
          ...(intensity ? { intensity } : {}),
        };
      })
      .filter(Boolean);

    if (segments.length === 0) {
      errors.push({ index: g + 1, message: 'No valid exercises found for group.' });
      continue;
    }

    const titleKey = `${baseTitle}::week${week}::day${day}`;

    const workoutStructure = {
      type: 'kaggle_program_day',
      source: 'KAGGLE',
      titleKey,
      meta: {
        goal: goal || null,
        level: level || null,
        equipment: equipmentRaw || null,
        program_length: programLength || null,
        time_per_workout: timePerWorkout || null,
      },
      segments,
    };

    items.push({
      title: `${baseTitle} (Week ${week} Day ${day})`,
      titleKey,
      discipline: WorkoutLibraryDiscipline.STRENGTH,
      tags,
      description,
      durationSec,
      intensityTarget,
      equipment,
      workoutStructure,
    });
  }

  return {
    items,
    summary: {
      scannedGroups: allGroupKeys.length,
      createdGroups: 0,
      skippedDuplicateGroups: 0,
      skippedInvalidTitleGroups,
      errors,
    },
  };
}

function parseCommaList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((v) => asString(v).trim()).filter(Boolean);
  }
  const text = asString(value).trim();
  if (!text) return [];
  return text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseDiscipline(value: unknown): WorkoutLibraryDiscipline | null {
  const raw = asString(value).trim().toUpperCase();
  if (!raw) return null;

  // Common variants.
  if (raw === 'RUN' || raw === 'RUNNING') return WorkoutLibraryDiscipline.RUN;
  if (raw === 'BIKE' || raw === 'CYCLING' || raw === 'CYCLE') return WorkoutLibraryDiscipline.BIKE;
  if (raw === 'SWIM' || raw === 'SWIMMING') return WorkoutLibraryDiscipline.SWIM;
  if (raw === 'BRICK') return WorkoutLibraryDiscipline.BRICK;
  if (raw === 'STRENGTH' || raw === 'GYM' || raw === 'LIFT' || raw === 'WEIGHTS') return WorkoutLibraryDiscipline.STRENGTH;
  if (raw === 'OTHER') return WorkoutLibraryDiscipline.OTHER;

  // Heuristic fallback.
  if (raw.includes('RUN')) return WorkoutLibraryDiscipline.RUN;
  if (raw.includes('BIKE') || raw.includes('CYCLE')) return WorkoutLibraryDiscipline.BIKE;
  if (raw.includes('SWIM')) return WorkoutLibraryDiscipline.SWIM;
  if (raw.includes('BRICK')) return WorkoutLibraryDiscipline.BRICK;
  if (raw.includes('STRENGTH') || raw.includes('GYM')) return WorkoutLibraryDiscipline.STRENGTH;

  return null;
}

const kaggleRowSchema = z
  .object({})
  .passthrough()
  .transform((raw) => {
    const r = raw as Record<string, unknown>;

    const title = (r.title ?? r.name ?? r.workout ?? r.exercise ?? '').toString().trim();
    const discipline = r.discipline ?? r.sport ?? r.type ?? r.category;
    const description = asString(r.description ?? r.desc ?? r.instructions ?? '').trim();
    const intensityTarget = asString(r.intensityTarget ?? r.intensity ?? r.level ?? '').trim();

    const durationSec =
      asNumber(r.durationSec) ??
      (asNumber(r.durationMinutes) != null ? (asNumber(r.durationMinutes) as number) * 60 : undefined) ??
      (asNumber(r.duration_min) != null ? (asNumber(r.duration_min) as number) * 60 : undefined);

    const distanceMeters =
      asNumber(r.distanceMeters) ??
      (asNumber(r.distanceKm) != null ? (asNumber(r.distanceKm) as number) * 1000 : undefined) ??
      (asNumber(r.distance_km) != null ? (asNumber(r.distance_km) as number) * 1000 : undefined) ??
      (asNumber(r.distance_m) != null ? (asNumber(r.distance_m) as number) : undefined);

    const elevationGainMeters = asNumber(r.elevationGainMeters ?? r.elevation_gain_meters ?? r.elevationGain);

    const tags = parseCommaList(r.tags ?? r.tag ?? r.categories ?? r.categoryTags);
    const equipment = parseCommaList(r.equipment ?? r.equipmentRequired ?? r.gear);

    return {
      title,
      discipline,
      description,
      intensityTarget,
      durationSec,
      distanceMeters: distanceMeters ?? null,
      elevationGainMeters: elevationGainMeters ?? null,
      notes: asString(r.notes ?? '').trim() || null,
      tags,
      equipment,
      workoutStructure: r.workoutStructure ?? r.structure ?? null,
    };
  });

export function normalizeKaggleRows(rows: unknown[], maxRows: number, offset = 0): {
  items: KaggleNormalizedItem[];
  errors: RowError[];
} {
  const errors: RowError[] = [];
  const items: KaggleNormalizedItem[] = [];

  const start = Math.max(0, offset);
  const slice = rows.slice(start, start + maxRows);

  for (let i = 0; i < slice.length; i++) {
    const parsed = kaggleRowSchema.safeParse(slice[i]);
    if (!parsed.success) {
      errors.push({ index: i + 1, message: 'Invalid row shape.' });
      continue;
    }

    const discipline = parseDiscipline(parsed.data.discipline);
    if (!parsed.data.title) {
      errors.push({ index: i + 1, message: 'title is required.' });
      continue;
    }
    if (!discipline) {
      errors.push({ index: i + 1, message: 'discipline is required and must be recognized.' });
      continue;
    }
    if (!parsed.data.description) {
      errors.push({ index: i + 1, message: 'description is required.' });
      continue;
    }
    if (!parsed.data.intensityTarget) {
      errors.push({ index: i + 1, message: 'intensityTarget is required.' });
      continue;
    }

    const hasDuration = typeof parsed.data.durationSec === 'number' && parsed.data.durationSec > 0;
    const hasDistance = typeof parsed.data.distanceMeters === 'number' && parsed.data.distanceMeters > 0;
    if (!hasDuration && !hasDistance) {
      errors.push({ index: i + 1, message: 'durationSec or distanceMeters is required.' });
      continue;
    }

    items.push({
      title: parsed.data.title,
      discipline,
      tags: normalizeTags(parsed.data.tags),
      description: parsed.data.description,
      durationSec: parsed.data.durationSec,
      intensityTarget: parsed.data.intensityTarget,
      distanceMeters: parsed.data.distanceMeters,
      elevationGainMeters: parsed.data.elevationGainMeters,
      notes: parsed.data.notes,
      equipment: normalizeEquipment(parsed.data.equipment),
      workoutStructure: parsed.data.workoutStructure,
    });
  }

  return { items, errors };
}
