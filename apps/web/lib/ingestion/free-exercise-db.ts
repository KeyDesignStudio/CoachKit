import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';

import { normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';

const DEFAULT_FREE_EXERCISE_DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

export type FreeExerciseDbRawExercise = Record<string, unknown>;

export type FreeExerciseDbCandidate = {
  title: string;
  discipline: 'STRENGTH';
  source: 'FREE_EXERCISE_DB';
  status: 'DRAFT';
  fingerprint: string;
  tags: string[];
  description: string;
  durationSec: number;
  intensityTarget: string;
  distanceMeters: null;
  elevationGainMeters: null;
  notes: null;
  equipment: string[];
  workoutStructure: unknown;
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCase(value: string): string {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) return '';

  return collapsed
    .split(' ')
    .map((token) => {
      const upper = token.toUpperCase();
      if (/^[A-Z0-9]{2,4}$/.test(upper)) return upper;
      return upper[0] + upper.slice(1).toLowerCase();
    })
    .join(' ');
}

function stableJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJsonStringify(v)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableJsonStringify(record[k])}`);
    return `{${parts.join(',')}}`;
  }

  return JSON.stringify(value);
}

export async function fetchFreeExerciseDb(): Promise<FreeExerciseDbRawExercise[]> {
  const localPath = process.env.FREE_EXERCISE_DB_DATA_PATH;
  if (localPath) {
    const resolved = path.isAbsolute(localPath) ? localPath : path.join(process.cwd(), localPath);
    const text = await readFile(resolved, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    const items = extractExercises(parsed);
    return items;
  }

  const url = process.env.FREE_EXERCISE_DB_URL || DEFAULT_FREE_EXERCISE_DB_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Free Exercise DB: ${res.status} ${res.statusText}`);
    }

    const parsed = (await res.json()) as unknown;
    return extractExercises(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

function extractExercises(payload: unknown): FreeExerciseDbRawExercise[] {
  if (Array.isArray(payload)) return payload as FreeExerciseDbRawExercise[];

  const obj = payload as Record<string, unknown>;
  const candidate = obj?.exercises ?? obj?.items ?? obj?.data;

  if (Array.isArray(candidate)) return candidate as FreeExerciseDbRawExercise[];

  throw new Error('Free Exercise DB payload must be an array or { exercises/items/data: [...] }.');
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => asString(v)).filter((v) => v.trim().length > 0);
  return [];
}

export function mapExerciseToLibrarySession(exercise: FreeExerciseDbRawExercise): Omit<FreeExerciseDbCandidate, 'fingerprint'> {
  const name = collapseWhitespace(asString(exercise.name ?? exercise.title ?? exercise.exerciseName ?? exercise.exercise));

  const equipmentRaw = collapseWhitespace(asString(exercise.equipment));

  const bodyPart = collapseWhitespace(asString(exercise.bodyPart ?? exercise.category));
  const target = collapseWhitespace(
    asString(exercise.target ?? (Array.isArray(exercise.primaryMuscles) ? (exercise.primaryMuscles as unknown[])[0] : ''))
  );

  const secondary = asStringArray(exercise.secondaryMuscles);

  const instructions = Array.isArray(exercise.instructions)
    ? asStringArray(exercise.instructions)
    : collapseWhitespace(asString(exercise.instructions))
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

  const tags = normalizeTags([
    'Strength',
    bodyPart,
    target,
    ...secondary,
  ].filter(Boolean));

  const equipment = normalizeEquipment(equipmentRaw ? [equipmentRaw] : []);

  const title = titleCase(name || 'Unnamed Exercise');

  const cues = instructions.length
    ? instructions.map((line) => `- ${collapseWhitespace(line)}`).join('\n')
    : '- (No instructions provided)';

  const detailParts = [
    `Exercise: ${title}`,
    [target ? `Target: ${titleCase(target)}` : '', bodyPart ? `Body: ${titleCase(bodyPart)}` : ''].filter(Boolean).join(' | '),
    equipmentRaw ? `Equipment: ${titleCase(equipmentRaw)}` : 'Equipment: (Not specified)',
    'Coaching cues:',
    cues,
  ].filter((p) => p.trim().length > 0);

  const description = detailParts.join('\n');

  const workoutStructure = {
    type: 'exercise',
    steps: instructions.map((s) => collapseWhitespace(s)),
    primary: target || null,
    secondary,
    equipment: equipmentRaw || null,
    media: {
      gifUrl: asString(exercise.gifUrl || ''),
      images: asStringArray(exercise.images),
    },
  };

  return {
    title,
    discipline: 'STRENGTH',
    source: 'FREE_EXERCISE_DB',
    status: 'DRAFT',
    tags,
    description,
    durationSec: 900,
    intensityTarget: 'Controlled',
    distanceMeters: null,
    elevationGainMeters: null,
    notes: null,
    equipment,
    workoutStructure,
  };
}

export function fingerprintCandidate(candidate: Omit<FreeExerciseDbCandidate, 'fingerprint'>): string {
  const canonical = {
    source: candidate.source,
    discipline: candidate.discipline,
    title: candidate.title,
    tags: [...candidate.tags].sort((a, b) => a.localeCompare(b)),
    equipment: [...candidate.equipment].sort((a, b) => a.localeCompare(b)),
    description: candidate.description,
    durationSec: candidate.durationSec,
    intensityTarget: candidate.intensityTarget,
    workoutStructure: candidate.workoutStructure,
  };

  const payload = stableJsonStringify(canonical);
  return createHash('sha256').update(payload).digest('hex');
}

export function buildFreeExerciseDbCandidate(exercise: FreeExerciseDbRawExercise): FreeExerciseDbCandidate {
  const base = mapExerciseToLibrarySession(exercise);
  const fingerprint = fingerprintCandidate(base);
  return { ...base, fingerprint };
}
