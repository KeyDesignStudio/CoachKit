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

function roundToIncrement(n: number, inc: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(inc) || inc <= 0) return 0;
  return Math.round(n / inc) * inc;
}

function getDurationMinutes(b: SessionDetailV1['structure'][number]): number {
  const n = (b as any)?.durationMinutes;
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function sumDurations(structure: SessionDetailV1['structure']): number {
  return structure.reduce((sum, b) => sum + getDurationMinutes(b), 0);
}

function findFirstIndex(structure: SessionDetailV1['structure'], blockType: SessionDetailBlockType): number {
  return structure.findIndex((b) => b.blockType === blockType);
}

function findLastIndex(structure: SessionDetailV1['structure'], blockType: SessionDetailBlockType): number {
  for (let i = structure.length - 1; i >= 0; i--) {
    if (structure[i]?.blockType === blockType) return i;
  }
  return -1;
}

function findMainIndex(structure: SessionDetailV1['structure']): number {
  const main = findFirstIndex(structure, 'main');
  if (main >= 0) return main;
  const strength = findFirstIndex(structure, 'strength');
  if (strength >= 0) return strength;
  // Fallback: treat the first non-warmup/cooldown block as "main".
  const idx = structure.findIndex((b) => b.blockType !== 'warmup' && b.blockType !== 'cooldown');
  return idx >= 0 ? idx : 0;
}

function withObjectiveDuration(objective: string, durationMinutes: number): string {
  const d = clampInt(durationMinutes, 0, 10_000);
  const s = String(objective || '').trim();
  if (!s) return `Session (${d} min).`;
  const stripped = s.replace(/\(\s*\d+\s*min\s*\)\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
  const base = stripped || 'Session';
  return `${base} (${d} min).`;
}

export function normalizeSessionDetailV1DurationsToTotal(params: {
  detail: SessionDetailV1;
  totalMinutes: number;
}): SessionDetailV1 {
  const totalMinutes = clampInt(params.totalMinutes, 0, 10_000);
  const detail: SessionDetailV1 = {
    ...params.detail,
    objective: withObjectiveDuration(params.detail.objective, totalMinutes),
    structure: params.detail.structure.map((b) => ({ ...b })),
  };

  // If total isn't divisible by 5, we still try to keep blocks human,
  // but preserve the exact total by placing any remainder into the main block.
  const inc = 5;
  const warmupIdx = findFirstIndex(detail.structure, 'warmup');
  const cooldownIdx = findLastIndex(detail.structure, 'cooldown');
  const mainIdx = findMainIndex(detail.structure);

  const hasWarmup = warmupIdx >= 0;
  const hasCooldown = cooldownIdx >= 0;

  if (totalMinutes > 0 && totalMinutes < 30) {
    if (hasWarmup) (detail.structure[warmupIdx] as any).durationMinutes = 5;
    if (hasCooldown) (detail.structure[cooldownIdx] as any).durationMinutes = 5;

    const fixed = (hasWarmup ? 5 : 0) + (hasCooldown ? 5 : 0);
    const remainder = Math.max(0, totalMinutes - fixed);
    if (detail.structure[mainIdx]) (detail.structure[mainIdx] as any).durationMinutes = remainder;

    // Keep other blocks but remove their minutes so we don't show awkward 0s.
    for (let i = 0; i < detail.structure.length; i++) {
      if (i === warmupIdx || i === cooldownIdx || i === mainIdx) continue;
      delete (detail.structure[i] as any).durationMinutes;
    }

    return {
      ...detail,
      objective: withObjectiveDuration(detail.objective, totalMinutes),
    };
  }

  // 1) Round all explicit durations to nearest 5.
  for (let i = 0; i < detail.structure.length; i++) {
    const b = detail.structure[i];
    const current = getDurationMinutes(b);
    if (current <= 0) {
      delete (b as any).durationMinutes;
      continue;
    }

    let next = roundToIncrement(current, inc);
    if (next < inc) next = inc;

    if (i === warmupIdx) next = clampInt(next, 5, 20);
    if (i === cooldownIdx) next = clampInt(next, 5, 15);
    if (i === mainIdx) next = Math.max(10, next);

    (b as any).durationMinutes = next;
  }

  // 2) Ensure required blocks have sensible mins when totalMinutes >= 30.
  if (hasWarmup) {
    const w = getDurationMinutes(detail.structure[warmupIdx]);
    if (w <= 0) (detail.structure[warmupIdx] as any).durationMinutes = 10;
  }
  if (hasCooldown) {
    const c = getDurationMinutes(detail.structure[cooldownIdx]);
    if (c <= 0) (detail.structure[cooldownIdx] as any).durationMinutes = 5;
  }
  if (detail.structure[mainIdx]) {
    const m = getDurationMinutes(detail.structure[mainIdx]);
    if (m <= 0) (detail.structure[mainIdx] as any).durationMinutes = Math.max(10, totalMinutes - 15);
  }

  // 3) Fix delta to match total, adjusting main first.
  const minWarmup = 5;
  const maxWarmup = 20;
  const minCooldown = 5;
  const maxCooldown = 15;
  const minMain = 10;

  const step = inc;
  let delta = totalMinutes - sumDurations(detail.structure);

  const canAdd = (idx: number): boolean => {
    if (idx < 0 || idx >= detail.structure.length) return false;
    if (idx === warmupIdx) return getDurationMinutes(detail.structure[idx]) < maxWarmup;
    if (idx === cooldownIdx) return getDurationMinutes(detail.structure[idx]) < maxCooldown;
    return true;
  };
  const canSub = (idx: number): boolean => {
    if (idx < 0 || idx >= detail.structure.length) return false;
    const cur = getDurationMinutes(detail.structure[idx]);
    if (idx === warmupIdx) return cur > minWarmup;
    if (idx === cooldownIdx) return cur > minCooldown;
    if (idx === mainIdx) return cur > minMain;
    return cur > step;
  };

  const addAt = (idx: number) => {
    const cur = getDurationMinutes(detail.structure[idx]);
    (detail.structure[idx] as any).durationMinutes = cur + step;
  };
  const subAt = (idx: number) => {
    const cur = getDurationMinutes(detail.structure[idx]);
    (detail.structure[idx] as any).durationMinutes = Math.max(0, cur - step);
  };

  // Add minutes: MAIN first.
  while (delta >= step) {
    const target = canAdd(mainIdx) ? mainIdx : canAdd(warmupIdx) ? warmupIdx : canAdd(cooldownIdx) ? cooldownIdx : -1;
    if (target < 0) break;
    addAt(target);
    delta -= step;
  }

  // Subtract minutes: MAIN first, then warmup/cooldown, then other blocks.
  while (delta <= -step) {
    const targets = [mainIdx, warmupIdx, cooldownIdx];
    let picked = targets.find((t) => canSub(t)) ?? -1;
    if (picked < 0) {
      for (let i = 0; i < detail.structure.length; i++) {
        if (i === mainIdx || i === warmupIdx || i === cooldownIdx) continue;
        if (canSub(i)) {
          picked = i;
          break;
        }
      }
    }
    if (picked < 0) break;
    subAt(picked);
    delta += step;
  }

  // If totalMinutes is not divisible by 5, put the remainder into MAIN.
  if (delta !== 0 && detail.structure[mainIdx]) {
    const cur = getDurationMinutes(detail.structure[mainIdx]);
    (detail.structure[mainIdx] as any).durationMinutes = Math.max(0, cur + delta);
    delta = 0;
  }

  // Hide any blocks that got reduced to 0.
  for (const b of detail.structure) {
    if (getDurationMinutes(b) <= 0) delete (b as any).durationMinutes;
  }

  return {
    ...detail,
    objective: withObjectiveDuration(detail.objective, totalMinutes),
  };
}

export function reflowSessionDetailV1ToNewTotal(params: {
  detail: SessionDetailV1;
  newTotalMinutes: number;
}): SessionDetailV1 {
  const newTotalMinutes = clampInt(params.newTotalMinutes, 0, 10_000);
  const detail: SessionDetailV1 = {
    ...params.detail,
    structure: params.detail.structure.map((b) => ({ ...b })),
  };

  const warmupIdx = findFirstIndex(detail.structure, 'warmup');
  const cooldownIdx = findLastIndex(detail.structure, 'cooldown');
  const mainIdx = findMainIndex(detail.structure);

  const currentTotal = sumDurations(detail.structure);
  let delta = newTotalMinutes - currentTotal;
  if (delta === 0) {
    return normalizeSessionDetailV1DurationsToTotal({ detail, totalMinutes: newTotalMinutes });
  }

  if (newTotalMinutes > 0 && newTotalMinutes < 30) {
    return normalizeSessionDetailV1DurationsToTotal({ detail, totalMinutes: newTotalMinutes });
  }

  // Apply delta by adjusting MAIN first, then warmup/cooldown within guardrails.
  const takeFrom = (idx: number, min: number, remaining: number): number => {
    if (idx < 0 || idx >= detail.structure.length) return remaining;
    const cur = getDurationMinutes(detail.structure[idx]);
    const canTake = Math.max(0, cur - min);
    const take = Math.min(canTake, remaining);
    (detail.structure[idx] as any).durationMinutes = cur - take;
    return remaining - take;
  };

  if (delta > 0) {
    if (detail.structure[mainIdx]) {
      const cur = getDurationMinutes(detail.structure[mainIdx]);
      (detail.structure[mainIdx] as any).durationMinutes = cur + delta;
      delta = 0;
    }
  } else {
    let remaining = -delta;
    remaining = takeFrom(mainIdx, 10, remaining);
    remaining = takeFrom(warmupIdx, 5, remaining);
    remaining = takeFrom(cooldownIdx, 5, remaining);
    // If we still need to remove time, take from any other blocks (down to 0).
    if (remaining > 0) {
      for (let i = 0; i < detail.structure.length && remaining > 0; i++) {
        if (i === mainIdx || i === warmupIdx || i === cooldownIdx) continue;
        remaining = takeFrom(i, 0, remaining);
      }
    }
  }

  return normalizeSessionDetailV1DurationsToTotal({ detail, totalMinutes: newTotalMinutes });
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
      steps: `Easy ${displayDiscipline.toLowerCase()} + dynamic warm-up.`,
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
