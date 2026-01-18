import { readFile } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';

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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });

        if (!res.ok) {
          console.error('[workout-library][kaggle] Fetch failed', {
            requestId,
            host,
            pathBase,
            status: res.status,
            statusText: res.statusText,
          });
          throw new ApiError(502, 'KAGGLE_FETCH_FAILED', `Failed to fetch Kaggle dataset (host=${host}, status=${res.status}).`);
        }

        let parsed: unknown;
        try {
          parsed = (await res.json()) as unknown;
        } catch (error) {
          console.error('[workout-library][kaggle] Parse failed (URL)', {
            requestId,
            host,
            pathBase,
            error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
          });
          throw new ApiError(500, 'KAGGLE_PARSE_FAILED', 'Failed to parse Kaggle dataset JSON.');
        }

        try {
          return extractRows(parsed);
        } catch (error) {
          console.error('[workout-library][kaggle] Invalid payload shape (URL)', {
            requestId,
            host,
            pathBase,
            error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
          });
          throw new ApiError(500, 'KAGGLE_PARSE_FAILED', 'Kaggle dataset JSON has an unexpected shape.');
        }
      } catch (error) {
        if (error instanceof TypeError || (error && typeof error === 'object' && 'name' in error && (error as any).name === 'AbortError')) {
          const err = error as any;
          console.error('[workout-library][kaggle] Network error', {
            requestId,
            host,
            pathBase,
            error: { name: err?.name, message: err?.message },
          });
          throw new ApiError(502, 'KAGGLE_FETCH_FAILED', `Failed to fetch Kaggle dataset (host=${host}).`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
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

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        console.error('[workout-library][kaggle] Parse failed (PATH)', {
          requestId,
          fileBase,
          error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
        });
        throw new ApiError(400, 'KAGGLE_PARSE_FAILED', `Failed to parse Kaggle dataset JSON (${fileBase}).`);
      }

      try {
        return extractRows(parsed);
      } catch (error) {
        console.error('[workout-library][kaggle] Invalid payload shape (PATH)', {
          requestId,
          fileBase,
          error: error instanceof Error ? { name: error.name, message: error.message } : { value: error },
        });
        throw new ApiError(400, 'KAGGLE_PARSE_FAILED', `Kaggle dataset JSON has an unexpected shape (${fileBase}).`);
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

type RowError = { index: number; message: string };

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
