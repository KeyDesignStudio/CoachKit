import { z } from 'zod';
import { sessionRecipeV2Schema, type SessionRecipeV2 } from './session-recipe';
type SessionRecipeTargetMetric = 'RPE' | 'ZONE' | 'PACE' | 'POWER' | 'HEART_RATE';

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

export const sessionDetailExplainabilitySchema = z
  .object({
    whyThis: z.string().min(1).max(400),
    whyToday: z.string().min(1).max(400),
    unlocksNext: z.string().min(1).max(400),
    ifMissed: z.string().min(1).max(400),
    ifCooked: z.string().min(1).max(400),
  })
  .strict();

export const sessionDetailVariantSchema = z
  .object({
    label: z.enum(['short-on-time', 'standard', 'longer-window', 'trainer', 'road', 'heat-adjusted', 'hills-adjusted', 'fatigue-adjusted']),
    whenToUse: z.string().min(1).max(260),
    durationMinutes: z.number().int().min(5).max(10_000),
    adjustments: z.array(z.string().min(1).max(220)).min(1).max(5),
  })
  .strict();

export const sessionDetailV1Schema = z
  .object({
    objective: z.string().min(1).max(240),
    purpose: z.string().min(1).max(240).optional(),
    structure: z.array(sessionDetailBlockSchema).min(1).max(20),
    targets: sessionDetailTargetsSchema,
    cues: z.array(z.string().min(1).max(160)).max(3).optional(),
    safetyNotes: z.string().min(1).max(800).optional(),
    explainability: sessionDetailExplainabilitySchema.optional(),
    variants: z.array(sessionDetailVariantSchema).max(8).optional(),
    recipeV2: sessionRecipeV2Schema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const structure = value.structure ?? [];
    const warmupIdx = structure.findIndex((b) => b.blockType === 'warmup');
    const cooldownIdx = structure.findIndex((b) => b.blockType === 'cooldown');
    const firstMainLikeIdx = structure.findIndex((b) => b.blockType === 'main' || b.blockType === 'strength');
    const warmupCount = structure.filter((b) => b.blockType === 'warmup').length;
    const cooldownCount = structure.filter((b) => b.blockType === 'cooldown').length;

    if (warmupCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['structure'],
        message: 'Only one warmup block is allowed.',
      });
    }
    if (cooldownCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['structure'],
        message: 'Only one cooldown block is allowed.',
      });
    }
    if (firstMainLikeIdx < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['structure'],
        message: 'Session structure must include at least one main or strength block.',
      });
    } else {
      if (warmupIdx >= 0 && warmupIdx > firstMainLikeIdx) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['structure', warmupIdx, 'blockType'],
          message: 'Warmup must appear before main work.',
        });
      }
      if (cooldownIdx >= 0 && cooldownIdx < firstMainLikeIdx) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['structure', cooldownIdx, 'blockType'],
          message: 'Cooldown must appear after main work.',
        });
      }
      if (cooldownIdx >= 0) {
        for (let i = cooldownIdx + 1; i < structure.length; i += 1) {
          if (structure[i]?.blockType !== 'cooldown') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['structure', i, 'blockType'],
              message: 'No work blocks are allowed after cooldown.',
            });
            break;
          }
        }
      }

    }

    if (value.targets.primaryMetric === 'RPE') {
      const hasRpe = structure.some((b) => typeof b.intensity?.rpe === 'number');
      if (!hasRpe) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', 'primaryMetric'],
          message: 'RPE primary metric requires at least one block with RPE.',
        });
      }
    }
    if (value.targets.primaryMetric === 'ZONE') {
      const hasZone = structure.some((b) => typeof b.intensity?.zone === 'string');
      if (!hasZone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', 'primaryMetric'],
          message: 'ZONE primary metric requires at least one block with zone.',
        });
      }
    }
  });

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

function stripObjectiveDuration(objective: string): string {
  const s = String(objective || '').trim();
  if (!s) return '';
  return s.replace(/\(\s*\d+\s*min\s*\)\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function normalizeObjectiveText(objective: string): string {
  const stripped = stripObjectiveDuration(objective);
  return stripped || 'Session';
}

export function normalizeSessionDetailV1DurationsToTotal(params: {
  detail: SessionDetailV1;
  totalMinutes: number;
}): SessionDetailV1 {
  const totalMinutes = clampInt(params.totalMinutes, 0, 10_000);
  const detail: SessionDetailV1 = {
    ...params.detail,
    objective: normalizeObjectiveText(params.detail.objective),
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
      objective: normalizeObjectiveText(detail.objective),
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
    objective: normalizeObjectiveText(detail.objective),
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

function inferPrimaryGoal(params: { discipline: string; type: string }): SessionRecipeV2['primaryGoal'] {
  const type = String(params.type ?? '').toLowerCase();
  if (type === 'threshold') return 'threshold-development';
  if (type === 'tempo') return 'tempo-control';
  if (type === 'technique') return 'technique-quality';
  if (type === 'recovery') return 'recovery-absorption';
  if (type === 'strength') return 'strength-resilience';
  if (type === 'endurance') return 'aerobic-durability';
  if (String(params.discipline ?? '').toLowerCase() === 'brick') return 'race-specificity';
  return 'aerobic-durability';
}

function inferTargetMetric(params: { discipline: string; type: string }): SessionRecipeTargetMetric {
  const discipline = String(params.discipline ?? '').toLowerCase();
  const type = String(params.type ?? '').toLowerCase();
  if (discipline === 'bike' && (type === 'tempo' || type === 'threshold' || type === 'endurance')) return 'POWER';
  if (discipline === 'run' && (type === 'tempo' || type === 'threshold')) return 'PACE';
  return 'RPE';
}

function buildMainIntervalPrescription(params: {
  discipline: string;
  type: string;
  mainMinutes: number;
  variationSeed: number;
}): Array<{ reps?: number; on: string; off?: string; intent: string }> {
  const discipline = String(params.discipline ?? '').toLowerCase();
  const type = String(params.type ?? '').toLowerCase();
  const main = Math.max(10, Math.round(params.mainMinutes || 0));
  const pick = <T,>(items: T[]): T => items[Math.abs(params.variationSeed) % items.length]!;

  if (discipline === 'swim' && type === 'technique') {
    const reps = Math.max(6, Math.min(16, Math.floor(main / 4)));
    return [
      pick([
        { reps, on: '50m drill + swim by 25m', off: '20s easy', intent: 'Improve feel for water and stroke timing.' },
        { reps: Math.max(4, Math.floor(reps / 2)), on: '100m pull buoy', off: '30s easy', intent: 'Build posture and catch quality under light aerobic load.' },
      ]),
    ];
  }

  if (discipline === 'bike' && type === 'endurance') {
    const reps = Math.max(2, Math.min(5, Math.round(main / 15)));
    const on = Math.max(8, Math.round(main / reps) - 2);
    return [{ reps, on: `${on} min Z2 steady`, off: '2 min easy spin', intent: 'Build aerobic durability with smooth cadence control.' }];
  }

  if (discipline === 'bike' && (type === 'tempo' || type === 'threshold')) {
    const work = type === 'threshold' ? 6 : 8;
    const reps = Math.max(3, Math.min(6, Math.floor(main / (work + 3))));
    const label = type === 'threshold' ? 'Z4 / RPE 7' : 'Z3 / RPE 6';
    return [{ reps, on: `${work} min @ ${label}`, off: '3 min easy spin', intent: 'Develop repeatable race-relevant power.' }];
  }

  if (discipline === 'run' && type === 'endurance') {
    return pick([
      [{ on: `${Math.max(20, main - 5)} min conversational running`, intent: 'Build durable aerobic run economy without excess stress.' }],
      [{ reps: Math.max(3, Math.round(main / 10)), on: '8 min steady', off: '2 min easy jog', intent: 'Accumulate controlled aerobic volume with form focus.' }],
    ]);
  }

  if (discipline === 'run' && (type === 'tempo' || type === 'threshold')) {
    const work = type === 'threshold' ? 5 : 7;
    const reps = Math.max(3, Math.min(7, Math.floor(main / (work + 3))));
    const pace = type === 'threshold' ? '10k effort / RPE 7' : 'HM effort / RPE 6';
    return [{ reps, on: `${work} min @ ${pace}`, off: '2-3 min easy jog', intent: 'Raise sustainable speed while preserving run durability.' }];
  }

  if (discipline === 'strength' || type === 'strength') {
    const rounds = Math.max(2, Math.min(5, Math.round(main / 10)));
    return [{ reps: rounds, on: 'Strength circuit (squat/hinge/core)', off: '60-90s between exercises', intent: 'Improve resilience and movement quality.' }];
  }

  if (type === 'recovery') {
    return [{ on: `${Math.max(15, main - 5)} min very easy aerobic`, intent: 'Facilitate recovery and maintain movement quality.' }];
  }

  return [{ on: `${Math.max(20, main - 5)} min steady aerobic`, intent: 'Build consistent foundational fitness.' }];
}

function renderRecipeIntervalLine(interval: {
  reps?: number;
  on: string;
  off?: string;
  intent: string;
}): string {
  const repsText = typeof interval.reps === 'number' ? `${interval.reps} x ` : '';
  const restText = interval.off ? `, ${interval.off}` : '';
  return `${repsText}${interval.on}${restText}. ${interval.intent}`;
}

function mapRecipeToSessionStructure(params: {
  recipe: SessionRecipeV2;
  fallbackIntensity: { zone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5'; rpe: number; notes: string };
}): SessionDetailV1['structure'] {
  return params.recipe.blocks.map((block) => {
    const metric = block.target?.metric;
    const zone =
      metric === 'ZONE'
        ? (block.target?.value.match(/Z[1-5]/)?.[0] as 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | undefined)
        : params.fallbackIntensity.zone;
    const rpeMatch = block.target?.value.match(/RPE\s*(\d(?:\.\d)?)/i);
    const rpe = rpeMatch ? Number(rpeMatch[1]) : params.fallbackIntensity.rpe;
    const intervalLines = Array.isArray(block.intervals) ? block.intervals.map(renderRecipeIntervalLine) : [];
    const noteLines = Array.isArray(block.notes) ? block.notes : [];
    const steps = [...intervalLines, ...noteLines].join(' ');

    return {
      blockType: block.key,
      ...(typeof block.durationMinutes === 'number' ? { durationMinutes: block.durationMinutes } : {}),
      intensity: {
        zone: zone ?? params.fallbackIntensity.zone,
        rpe,
        notes: block.target?.notes || params.fallbackIntensity.notes,
      },
      steps: steps || 'Execute with controlled form and smooth pacing.',
    };
  });
}

function buildSessionRecipeV2(params: {
  discipline: string;
  type: string;
  purpose: string;
  structure: SessionDetailV1['structure'];
  explainability: NonNullable<SessionDetailV1['explainability']>;
  variationSeed: number;
}): SessionRecipeV2 {
  const metric = inferTargetMetric({ discipline: params.discipline, type: params.type });
  const defaultValue =
    metric === 'POWER'
      ? params.type === 'threshold'
        ? 'Z4 / RPE 7'
        : params.type === 'tempo'
          ? 'Z3 / RPE 6'
          : 'Z2 / RPE 4'
      : metric === 'PACE'
        ? params.type === 'threshold'
          ? '10k effort / RPE 7'
          : 'HM effort / RPE 6'
        : params.type === 'recovery'
          ? 'RPE 2-3'
          : params.type === 'technique'
            ? 'RPE 3-4'
            : 'RPE 4-6';

  const blocks: SessionRecipeV2['blocks'] = params.structure.map((b) => {
    const entry: SessionRecipeV2['blocks'][number] = {
      key: b.blockType,
      ...(typeof b.durationMinutes === 'number' ? { durationMinutes: b.durationMinutes } : {}),
      ...(b.steps
        ? {
            notes: b.steps
              .split(/\.\s+/)
              .map((x) => x.trim())
              .filter(Boolean)
              .slice(0, 3),
          }
        : {}),
    };

    if (b.blockType === 'main' || b.blockType === 'drill' || b.blockType === 'strength') {
      const intervals = buildMainIntervalPrescription({
        discipline: params.discipline,
        type: params.type,
        mainMinutes: Number(b.durationMinutes ?? 0),
        variationSeed: params.variationSeed,
      });
      entry.target = {
        metric,
        value: defaultValue,
        notes: b.intensity?.notes || undefined,
      };
      entry.intervals = intervals;
    }

    return entry;
  });

  return sessionRecipeV2Schema.parse({
    version: 'v2',
    primaryGoal: inferPrimaryGoal({ discipline: params.discipline, type: params.type }),
    executionSummary: params.purpose,
    blocks,
    adjustments: {
      ifMissed: [
        params.explainability.ifMissed,
        'Do not stack missed intensity into the next day.',
      ],
      ifCooked: [
        params.explainability.ifCooked,
        'Reduce intensity first, then reduce volume if still flat.',
      ],
    },
    qualityChecks: [
      'Warm-up and cooldown included before and after key work.',
      'Main set stays aligned to today’s primary purpose.',
      'Execution should finish controlled, not all-out.',
    ],
  });
}

export function buildDeterministicSessionDetailV1(params: {
  discipline: string;
  type: string;
  durationMinutes: number;
  context?: {
    availableTimeMinutes?: number;
    equipment?: string | null;
    environmentTags?: string[] | null;
    fatigueState?: 'fresh' | 'normal' | 'fatigued' | 'cooked' | string | null;
    weekIndex?: number | null;
    dayOfWeek?: number | null;
    sessionOrdinal?: number | null;
  };
}): SessionDetailV1 {
  const discipline = String(params.discipline || '').trim().toLowerCase();
  const requestedType = String(params.type || '').trim().toLowerCase();
  const fatigueState = String(params.context?.fatigueState ?? '').toLowerCase();
  const type =
    fatigueState === 'cooked' && (requestedType === 'threshold' || requestedType === 'tempo')
      ? 'recovery'
      : fatigueState === 'fatigued' && requestedType === 'threshold'
        ? 'tempo'
        : requestedType;
  const requestedDuration = clampInt(params.durationMinutes, 0, 10_000);
  const availableTime = Number(params.context?.availableTimeMinutes ?? 0);
  const durationMinutes = Number.isFinite(availableTime) && availableTime > 0 ? Math.max(20, Math.min(requestedDuration, Math.round(availableTime))) : requestedDuration;

  const displayDiscipline = discipline ? titleCaseWord(discipline) : 'Workout';
  const displayType = type ? titleCaseWord(type) : 'Session';

  const { warmup, main, cooldown } = splitDuration(durationMinutes);

  const keyStimulusText = (() => {
    if (type === 'threshold') return 'raise sustainable race-adjacent output';
    if (type === 'tempo') return 'build durable sub-threshold speed';
    if (type === 'technique') return 'improve movement economy and technical quality';
    if (type === 'recovery') return 'promote adaptation while reducing fatigue';
    if (type === 'strength') return 'build resilient movement patterns and force control';
    return 'build aerobic durability with controlled stress';
  })();

  const intensityByType: Record<string, { zone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5'; rpe: number; notes: string }> = {
    recovery: { zone: 'Z1', rpe: 2, notes: 'Very easy / absorb load' },
    technique: { zone: 'Z2', rpe: 4, notes: 'Technical quality' },
    endurance: { zone: 'Z2', rpe: 4, notes: 'Steady aerobic' },
    tempo: { zone: 'Z3', rpe: 6, notes: 'Controlled hard' },
    threshold: { zone: 'Z4', rpe: 7, notes: 'Sustainably hard' },
    strength: { zone: 'Z2', rpe: 5, notes: 'Controlled strength work' },
  };
  const intensity = intensityByType[type] ?? intensityByType.endurance;

  const equipment = String(params.context?.equipment ?? '').toLowerCase();
  const environment = (params.context?.environmentTags ?? []).map((v) => String(v).toLowerCase());
  const variationSeed = Math.abs(
    (Number(params.context?.weekIndex ?? 0) + 1) * 31 +
      (Number(params.context?.dayOfWeek ?? 0) + 1) * 17 +
      (Number(params.context?.sessionOrdinal ?? 0) + 1) * 11 +
      durationMinutes
  );
  const pick = <T,>(items: T[]): T => {
    if (!items.length) return '' as T;
    return items[variationSeed % items.length]!;
  };

  const warmupSteps = (() => {
    if (discipline === 'swim') return pick(['200m easy + 4 x 50m drill/swim by 25m', '300m relaxed swim with every 4th length backstroke', '8 min easy swim + 6 x 25m form drill']);
    if (discipline === 'bike') return pick(['8-12 min easy spin, include 3 x 30s high cadence', '10 min progressive spin (Z1->Z2)', '5 min easy + 3 x 1 min spin-up / 1 min easy']);
    if (discipline === 'run') return pick(['8-10 min easy jog + mobility + 4 strides', '10 min easy run + drills (A-skips/high knees)', '12 min easy jog with cadence focus']);
    if (discipline === 'strength') return pick(['5-8 min mobility flow + activation bands', '10 min dynamic warm-up: hips, ankles, t-spine', '5 min easy cardio + movement prep']);
    return `Easy ${displayDiscipline.toLowerCase()} + dynamic warm-up.`;
  })();

  const mainSteps = (() => {
    const mainWork = Math.max(10, main);
    if (discipline === 'swim' && type === 'technique') {
      const reps = Math.max(4, Math.min(12, Math.floor(mainWork / 5)));
      return pick([
        `${reps} x 50m as 25m drill + 25m swim, 20s rest. Keep stroke length and relaxed exhale.`,
        `4 x ${Math.max(100, Math.round((reps * 50) / 4 / 25) * 25)}m pull buoy, 30s rest, focus on body position.`,
        `3 rounds: 200m steady + 4 x 25m build. Rest 30s between rounds.`,
      ]);
    }
    if (discipline === 'bike' && type === 'endurance') {
      const intervals = Math.max(2, Math.min(5, Math.round(mainWork / 15)));
      const on = Math.max(8, Math.round(mainWork / intervals) - 2);
      return pick([
        `${intervals} x ${on} min steady Z2, 2 min easy between. Hold smooth cadence.`,
        `${Math.max(20, mainWork - 10)} min continuous aerobic with cadence changes every 5 min.`,
        `${Math.max(3, intervals)} x ${Math.max(6, on - 2)} min seated aerobic climbing effort, 2 min easy spin.`,
      ]);
    }
    if (discipline === 'bike' && (type === 'tempo' || type === 'threshold')) {
      const work = type === 'threshold' ? 8 : 10;
      const reps = Math.max(2, Math.min(5, Math.floor(mainWork / (work + 4))));
      const rest = type === 'threshold' ? 4 : 3;
      const label = type === 'threshold' ? 'Z4 / RPE 7' : 'Z3 / RPE 6';
      return pick([
        `${reps} x ${work} min @ ${label}, ${rest} min easy between. Keep power/effort even.`,
        `${Math.max(2, reps - 1)} x ${work + 2} min controlled hard, ${rest} min easy.`,
        `Pyramid: 6-8-10-${Math.max(8, work)} min at ${label}, 3 min easy between steps.`,
      ]);
    }
    if (discipline === 'run' && type === 'endurance') {
      return pick([
        `${Math.max(25, mainWork - 5)} min conversational run. Last 5 min can progress slightly if legs are fresh.`,
        `${Math.max(20, mainWork - 10)} min easy run + 6 x 20s strides (walk back).`,
        `${Math.max(3, Math.round(mainWork / 12))} x 8 min steady / 2 min easy jog.`,
      ]);
    }
    if (discipline === 'run' && (type === 'tempo' || type === 'threshold')) {
      const on = type === 'threshold' ? 6 : 8;
      const reps = Math.max(3, Math.min(7, Math.floor(mainWork / (on + 3))));
      const intensityText = type === 'threshold' ? '10k effort (RPE 7)' : 'half-marathon effort (RPE 6)';
      return pick([
        `${reps} x ${on} min @ ${intensityText}, 2-3 min easy jog between.`,
        `${Math.max(12, mainWork - 12)} min sustained tempo after building for 8 min.`,
        `Ladder: 4-6-8-6-4 min @ ${intensityText}, equal jog recoveries.`,
      ]);
    }
    if (discipline === 'strength' || type === 'strength') {
      const rounds = Math.max(2, Math.min(5, Math.round(mainWork / 10)));
      return pick([
        `${rounds} rounds: split squat 8/leg, single-leg RDL 8/leg, plank 45s, calf raise 12/leg.`,
        `${rounds} rounds: goblet squat 10, step-up 8/leg, dead bug 10/side, side plank 30s/side.`,
        `${rounds} rounds: hinge pattern + pull + anti-rotation core. Keep load controlled; stop with 2 reps in reserve.`,
      ]);
    }
    if (type === 'recovery') {
      return pick([
        `${Math.max(15, mainWork - 5)} min very easy aerobic work. Keep breathing nasal/relaxed.`,
        `Cadence and form reset: ${Math.max(3, Math.round(mainWork / 8))} x 4 min smooth + 2 min easy.`,
        `${Math.max(20, mainWork - 10)} min easy movement with no hard surges.`,
      ]);
    }
    return `${displayType} work at steady effort. Keep form smooth.`;
  })();

  const cooldownSteps = (() => {
    if (discipline === 'swim') return pick(['Easy 100-200m choice stroke + 2 min mobility', '5-8 min easy swim, long strokes', '4 min easy swim + shoulder mobility']);
    if (discipline === 'bike') return pick(['Easy spin, cadence down each minute; finish with hip flexor stretch', '5-10 min very easy spin + light mobility', 'Spin easy and keep breathing controlled to baseline']);
    if (discipline === 'run') return pick(['Easy jog/walk to finish + calf/hamstring mobility', '5-10 min easy jog, then leg swings and calf work', 'Walk 3 min then light posterior-chain stretch']);
    if (discipline === 'strength') return pick(['Gentle mobility and breathing reset', 'Light stretch: calves, hip flexors, glutes', 'Easy cooldown circuit + controlled breathing']);
    return `Easy ${displayDiscipline.toLowerCase()} to finish, then light stretching.`;
  })();

  const structure: SessionDetailV1['structure'] = [];
  if (warmup > 0) {
    structure.push({
      blockType: 'warmup',
      durationMinutes: warmup,
      intensity: { zone: 'Z1', rpe: 2, notes: 'Easy' },
      steps: warmupSteps,
    });
  }

  if (discipline === 'swim' && type === 'technique' && main >= 20) {
    const drillMinutes = clampInt(Math.round(main * 0.3), 8, Math.max(8, main - 10));
    structure.push({
      blockType: 'drill',
      durationMinutes: drillMinutes,
      intensity: { zone: 'Z2', rpe: 4, notes: 'Form first' },
      steps: 'Dedicated drill set: catch-up, fingertip drag, and 6-1-6 balance drill. Keep precision high.',
    });
    structure.push({
      blockType: 'main',
      durationMinutes: Math.max(10, main - drillMinutes),
      intensity,
      steps: mainSteps,
    });
  } else {
    const primaryBlockType: SessionDetailBlockType = discipline === 'strength' ? 'strength' : 'main';
    structure.push({
      blockType: primaryBlockType,
      durationMinutes: main,
      intensity,
      steps: mainSteps,
    });
  }

  if (cooldown > 0) {
    structure.push({
      blockType: 'cooldown',
      durationMinutes: cooldown,
      intensity: { zone: 'Z1', rpe: 2, notes: 'Easy' },
      steps: cooldownSteps,
    });
  }

  if (structure.length === 0) {
    structure.push({
      blockType: discipline === 'strength' ? 'strength' : 'main',
      intensity,
      steps: mainSteps,
    });
  }

  const standardDuration = Math.max(20, durationMinutes);
  const shortDuration = Math.max(20, Math.min(standardDuration - 10, 45));
  const longerDuration = Math.max(standardDuration + 15, Math.min(standardDuration + 25, 120));

  const variants: SessionDetailV1['variants'] = [
    {
      label: 'short-on-time',
      whenToUse: 'Use when schedule is compressed but you still want the key stimulus.',
      durationMinutes: shortDuration,
      adjustments: ['Keep warmup and cooldown', 'Trim main set volume first', 'Maintain quality not quantity'],
    },
    {
      label: 'standard',
      whenToUse: 'Default execution for today.',
      durationMinutes: standardDuration,
      adjustments: ['Execute as written', 'Keep effort controlled', 'Stop early if pain escalates'],
    },
    {
      label: 'longer-window',
      whenToUse: 'Use when you have extra time and feel fresh.',
      durationMinutes: longerDuration,
      adjustments: ['Add easy aerobic volume after core set', 'Do not add extra high-intensity reps'],
    },
  ];

  if (equipment.includes('trainer')) {
    variants.push({
      label: 'trainer',
      whenToUse: 'Indoor setup or controlled pacing conditions.',
      durationMinutes: standardDuration,
      adjustments: ['Use cadence targets', 'Prioritize consistent power/effort', 'Increase cooling and hydration'],
    });
  } else if (equipment.includes('road')) {
    variants.push({
      label: 'road',
      whenToUse: 'Outdoor route with safe conditions.',
      durationMinutes: standardDuration,
      adjustments: ['Choose terrain that matches session intent', 'Keep surges controlled', 'Fuel and hydrate early'],
    });
  }

  if (environment.includes('heat')) {
    variants.push({
      label: 'heat-adjusted',
      whenToUse: 'Hot or humid conditions.',
      durationMinutes: Math.max(20, standardDuration - 10),
      adjustments: ['Reduce intensity by one zone/RPE point', 'Extend recoveries', 'Prioritize hydration and cooling'],
    });
  }
  if (environment.includes('hills')) {
    variants.push({
      label: 'hills-adjusted',
      whenToUse: 'Hilly terrain affecting effort stability.',
      durationMinutes: standardDuration,
      adjustments: ['Use effort targets over pace', 'Keep uphill work sub-threshold unless prescribed', 'Descend easy to reset'],
    });
  }
  if (fatigueState === 'fatigued' || fatigueState === 'cooked') {
    variants.push({
      label: 'fatigue-adjusted',
      whenToUse: 'Elevated fatigue, poor sleep, or heavy legs.',
      durationMinutes: Math.max(20, standardDuration - 15),
      adjustments: ['Convert hard reps to aerobic', 'Cut total reps by 20-40%', 'Finish feeling better than start'],
    });
  }

  const explainability: NonNullable<SessionDetailV1['explainability']> = {
    whyThis: `This session is designed to ${keyStimulusText}.`,
    whyToday: "It is placed to build adaptation now while protecting tomorrow's training quality and recovery budget.",
    unlocksNext: 'Completing this well supports progression into the next quality workout and long-session durability.',
    ifMissed: 'Skip catch-up intensity. Resume the plan at the next session and protect consistency for the week.',
    ifCooked: 'Drop one intensity level, reduce reps, or switch to steady aerobic work while keeping technique clean.',
  };

  const purpose = `Primary purpose: ${keyStimulusText}.`;
  const recipeV2 = buildSessionRecipeV2({
    discipline,
    type,
    purpose,
    structure,
    explainability,
    variationSeed,
  });
  const recipeDrivenStructure = mapRecipeToSessionStructure({
    recipe: recipeV2,
    fallbackIntensity: intensity,
  });

  return {
    objective: `${displayType} ${displayDiscipline.toLowerCase()} session`.trim(),
    purpose,
    structure: recipeDrivenStructure,
    targets: {
      primaryMetric: 'RPE',
      notes:
        type === 'threshold' || type === 'tempo'
          ? 'Hold effort at prescribed RPE/zone with repeatable pacing; stop if form or control drops.'
          : 'Stay controlled; keep quality high and adjust down if fatigue, pain, or heat rises.',
    },
    cues: ['Smooth form under fatigue', 'Fuel/hydrate early for sessions > 60 min', 'Stop if sharp pain'],
    safetyNotes: 'Avoid maximal efforts if you feel pain, dizziness, or unusual fatigue.',
    explainability,
    variants: variants.filter((v, idx, arr) => arr.findIndex((x) => x.label === v.label) === idx),
    recipeV2,
  };
}
