import { createHash } from 'node:crypto';

import { WorkoutLibraryDiscipline } from '@prisma/client';

function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function stableSort(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stableSort);
  if (typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = stableSort(obj[k]);
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSort(value));
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function computeWorkoutLibraryFingerprint(input: {
  discipline: WorkoutLibraryDiscipline;
  title: string;
  durationSec: number;
  distanceMeters: number | null;
  intensityTarget: string;
  workoutStructure: unknown | null;
}): string {
  const normalizedTitle = normalizeTitle(input.title);
  const normalizedIntensity = input.intensityTarget.trim().toLowerCase();
  const distance = input.distanceMeters ?? '';

  const structureHash = sha256Hex(stableStringify(input.workoutStructure ?? null));

  const base = [
    input.discipline,
    normalizedTitle,
    String(input.durationSec ?? 0),
    String(distance),
    normalizedIntensity,
    structureHash,
  ].join('|');

  return sha256Hex(base);
}

export function computeWorkoutLibraryPromptFingerprint(input: {
  discipline: WorkoutLibraryDiscipline;
  title: string;
  category: string | null;
}): string {
  const normalizedTitle = normalizeTitle(input.title);
  const normalizedCategory = (input.category ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const base = [input.discipline, normalizedTitle, normalizedCategory].join('|');
  return sha256Hex(base);
}
