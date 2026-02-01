import { z } from 'zod';

export const sessionDetailBlockTypeSchema = z.enum(['warmup', 'main', 'cooldown', 'drill', 'strength']);
export type SessionDetailBlockType = z.infer<typeof sessionDetailBlockTypeSchema>;

export const sessionDetailIntensitySchema = z
  .object({
    rpe: z.number().min(1).max(10).optional(),
    zone: z.enum(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']).optional(),
    notes: z.string().min(1).max(200).optional(),
  })
  .strict();

export const sessionDetailBlockSchema = z
  .object({
    blockType: sessionDetailBlockTypeSchema,
    durationMinutes: z.number().int().min(0).max(10_000).optional(),
    distanceMeters: z.number().int().min(0).max(1_000_000).optional(),
    intensity: sessionDetailIntensitySchema.optional(),
    steps: z.string().min(1).max(1_000),
  })
  .strict();

export const sessionDetailTargetsSchema = z
  .object({
    primaryMetric: z.enum(['RPE', 'ZONE']),
    notes: z.string().min(1).max(500),
  })
  .strict();

export const sessionDetailV1Schema = z
  .object({
    objective: z.string().min(1).max(240),
    structure: z.array(sessionDetailBlockSchema).min(1).max(20),
    targets: sessionDetailTargetsSchema,
    cues: z.array(z.string().min(1).max(160)).max(3).optional(),
    safetyNotes: z.string().min(1).max(800).optional(),
  })
  .strict();

export type SessionDetailV1 = z.infer<typeof sessionDetailV1Schema>;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function splitDuration(durationMinutes: number): { warmup: number; main: number; cooldown: number } {
  const total = clampInt(durationMinutes, 0, 10_000);
  if (total <= 0) return { warmup: 0, main: 0, cooldown: 0 };

  // Deterministic, simple split that always sums back to total.
  const warmup = clampInt(Math.round(total * 0.15), 0, total);
  const cooldown = clampInt(Math.round(total * 0.1), 0, total - warmup);
  const main = clampInt(total - warmup - cooldown, 0, total);

  return { warmup, main, cooldown };
}

function titleCaseWord(word: string): string {
  const s = String(word || '').trim();
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

export function buildDeterministicSessionDetailV1(params: {
  discipline: string;
  type: string;
  durationMinutes: number;
}): SessionDetailV1 {
  const discipline = String(params.discipline || '').trim().toLowerCase();
  const type = String(params.type || '').trim().toLowerCase();
  const durationMinutes = clampInt(params.durationMinutes, 0, 10_000);

  const displayDiscipline = discipline ? titleCaseWord(discipline) : 'Workout';
  const displayType = type ? titleCaseWord(type) : 'Session';

  const { warmup, main, cooldown } = splitDuration(durationMinutes);

  const structure: SessionDetailV1['structure'] = [];

  if (warmup > 0) {
    structure.push({
      blockType: 'warmup',
      durationMinutes: warmup,
      intensity: { zone: 'Z1', rpe: 2, notes: 'Easy' },
      steps: `Easy ${displayDiscipline.toLowerCase()} + mobility.`,
    });
  }

  if (main > 0) {
    const primaryBlockType: SessionDetailBlockType = discipline === 'strength' ? 'strength' : 'main';
    structure.push({
      blockType: primaryBlockType,
      durationMinutes: main,
      intensity: { zone: 'Z2', rpe: 4, notes: 'Steady' },
      steps: `${displayType} work at steady effort. Keep form smooth.`,
    });
  }

  if (cooldown > 0) {
    structure.push({
      blockType: 'cooldown',
      durationMinutes: cooldown,
      intensity: { zone: 'Z1', rpe: 2, notes: 'Easy' },
      steps: `Easy ${displayDiscipline.toLowerCase()} to finish, then light stretching.`,
    });
  }

  return {
    objective: `${displayType} ${displayDiscipline.toLowerCase()} session (${durationMinutes} min).`,
    structure,
    targets: {
      primaryMetric: 'RPE',
      notes: 'Stay controlled; adjust down if fatigued.',
    },
    cues: ['Smooth form', 'Breathe steady', 'Stop if sharp pain'],
    safetyNotes: 'Avoid maximal efforts if you feel pain, dizziness, or unusual fatigue.',
  };
}
