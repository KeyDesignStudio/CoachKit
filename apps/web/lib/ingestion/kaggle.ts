import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';

import { normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';

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

export function normalizeKaggleRows(rows: unknown[], maxRows: number): {
  items: KaggleNormalizedItem[];
  errors: RowError[];
} {
  const errors: RowError[] = [];
  const items: KaggleNormalizedItem[] = [];

  const slice = rows.slice(0, maxRows);

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
