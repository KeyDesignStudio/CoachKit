import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAMPLE_DEFAULT_BYTES = 5 * 1024 * 1024;
const SAMPLE_CAP_BYTES = 20 * 1024 * 1024;

function parseBooleanish(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return null;
}

function isKaggleImportEnabled(request: NextRequest): { enabled: boolean; source: 'default' | 'env' | 'cookie' } {
  // Default to enabled unless explicitly disabled.
  const env = parseBooleanish(process.env.ENABLE_KAGGLE_IMPORT ?? '');
  let enabled = env ?? true;
  let source: 'default' | 'env' | 'cookie' = env === null ? 'default' : 'env';

  // Test-only override: allows Playwright to flip enabled/disabled per-browser-context.
  if (process.env.DISABLE_AUTH === 'true') {
    const cookie = request.cookies.get('coachkit-kaggle-import-enabled')?.value;
    const parsed = cookie ? parseBooleanish(cookie) : null;
    if (parsed !== null) {
      enabled = parsed;
      source = 'cookie';
    }
  }

  return { enabled, source };
}

function clampSampleBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return SAMPLE_DEFAULT_BYTES;
  return Math.min(Math.max(1024, Math.trunc(value)), SAMPLE_CAP_BYTES);
}

function getKaggleSampleBytes(request: NextRequest): { sampleBytes: number; source: 'default' | 'env' | 'cookie' } {
  const envRaw = (process.env.KAGGLE_SAMPLE_BYTES ?? '').trim();
  const envParsed = envRaw ? Number(envRaw) : NaN;
  let sampleBytes = clampSampleBytes(Number.isFinite(envParsed) ? envParsed : SAMPLE_DEFAULT_BYTES);
  let source: 'default' | 'env' | 'cookie' = envRaw ? 'env' : 'default';

  // Test-only override: allows Playwright to render non-default sample windows without restarting the server.
  if (process.env.DISABLE_AUTH === 'true') {
    const cookie = request.cookies.get('coachkit-kaggle-sample-bytes')?.value;
    const parsed = cookie ? Number(cookie) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      sampleBytes = clampSampleBytes(parsed);
      source = 'cookie';
    }
  }

  return { sampleBytes, source };
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    await requireWorkoutLibraryAdmin();

    const enabled = isKaggleImportEnabled(request);
    const sample = getKaggleSampleBytes(request);

    const sampleMb = Math.max(1, Math.round(sample.sampleBytes / (1024 * 1024)));

    return success({
      enabled: enabled.enabled,
      enabledSource: enabled.source,
      sampleBytes: sample.sampleBytes,
      sampleMb,
      sampleSource: sample.source,
      sampleDefaultBytes: SAMPLE_DEFAULT_BYTES,
      sampleCapBytes: SAMPLE_CAP_BYTES,
    });
  } catch (error) {
    return handleError(error, { requestId, where: 'admin.kaggle.config' });
  }
}
