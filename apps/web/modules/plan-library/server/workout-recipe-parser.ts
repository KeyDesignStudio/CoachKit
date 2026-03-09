import type { PlanSourceDiscipline } from '@prisma/client';

import { sessionRecipeV2Schema, type SessionRecipeV2 } from '@/modules/ai-plan-builder/rules/session-recipe';
import { normalizeDistanceTokenToKm, normalizeDistanceUnitsToKm, parseDistanceKm } from './distance-utils';

type SessionRecipeMetric = 'RPE' | 'ZONE' | 'PACE' | 'POWER' | 'HEART_RATE';
type SessionRecipeBlockKey = SessionRecipeV2['blocks'][number]['key'];

export type ParsedWorkoutRecipe = {
  recipeV2: SessionRecipeV2 | null;
  intensityType: string | null;
  intensityTargetJson: {
    primaryTarget?: {
      metric: SessionRecipeMetric;
      value: string;
      notes?: string;
    } | null;
    blockTargets?: Array<{
      blockKey: SessionRecipeBlockKey;
      metric: SessionRecipeMetric;
      value: string;
      notes?: string;
    }>;
  } | null;
  estimatedDurationMinutes: number | null;
  warnings: string[];
  confidence: number;
};

type ParsedTarget = {
  metric: SessionRecipeMetric;
  value: string;
  notes?: string;
};

type DraftBlock = {
  key: SessionRecipeBlockKey;
  lines: string[];
};

const BULLET_REGEX = /[\u2022\u2023\u25e6\u2043\u2219\uf0b7]/g;
const FRACTION_HALF_REGEX = /\u00bd/g;
const FRACTION_QUARTER_REGEX = /\u00bc/g;
const FRACTION_THREE_QUARTERS_REGEX = /\u00be/g;
const HOURS_REGEX = /(h|hr|hrs|hour|hours)\b/i;
const MINS_REGEX = /(min|mins|minute|minutes)\b/i;
const SECONDS_REGEX = /(s|sec|secs|second|seconds)\b/i;

function normalizeText(value: string) {
  return normalizeDistanceUnitsToKm(
    value
    .replace(BULLET_REGEX, '-')
    .replace(FRACTION_HALF_REGEX, '0.5')
    .replace(FRACTION_QUARTER_REGEX, '0.25')
    .replace(FRACTION_THREE_QUARTERS_REGEX, '0.75')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  );
}

function compact(value: string) {
  return normalizeText(value).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function toMinutes(value: number, unit: string) {
  if (HOURS_REGEX.test(unit)) return value * 60;
  if (SECONDS_REGEX.test(unit)) return value / 60;
  return value;
}

function parseNumericRangeToMinutes(text: string): number | null {
  const normalized = compact(text).replace(/,/g, '');

  const sharedUnitRangeMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i
  );
  if (sharedUnitRangeMatch) {
    const start = toMinutes(Number(sharedUnitRangeMatch[1]), sharedUnitRangeMatch[3]);
    const end = toMinutes(Number(sharedUnitRangeMatch[2]), sharedUnitRangeMatch[3]);
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.round((start + end) / 2);
  }

  const rangeMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i
  );
  if (rangeMatch) {
    const start = toMinutes(Number(rangeMatch[1]), rangeMatch[2]);
    const end = toMinutes(Number(rangeMatch[3]), rangeMatch[4]);
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.round((start + end) / 2);
  }

  const singleMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i);
  if (!singleMatch) return null;
  const minutes = toMinutes(Number(singleMatch[1]), singleMatch[2]);
  return Number.isFinite(minutes) ? Math.round(minutes) : null;
}

function parseLeadingIntervalToken(text: string) {
  const normalized = compact(text).replace(/,/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(km|m|mi|miles?|hours?|hrs?|hr|h|minutes?|mins?|min|sec|secs|seconds?)\b/i);
  if (!match) return null;
  const token = `${match[1]}${match[2].toLowerCase() === 'minutes' ? 'min' : match[2]}`.replace(/\s+/g, '');
  const normalizedToken = /^(?:\d+(?:\.\d+)?)(?:mi|miles?|mile)$/i.test(token) ? normalizeDistanceTokenToKm(token) : token;
  return {
    token: normalizedToken,
    rest: normalized.slice(match[0].length).replace(/^[\s,:-]+/, '').trim(),
    durationMinutes:
      MINS_REGEX.test(match[2]) || HOURS_REGEX.test(match[2]) || SECONDS_REGEX.test(match[2])
        ? Math.max(0, Math.round(toMinutes(Number(match[1]), match[2])))
        : null,
  };
}

function parseTarget(text: string): ParsedTarget | null {
  const normalized = compact(text);

  const rpeMatch = normalized.match(/\b(?:PE|RPE)\s*(\d(?:\.\d+)?(?:\s*-\s*\d(?:\.\d+)?)?)\b/i);
  if (rpeMatch) {
    return {
      metric: 'RPE',
      value: rpeMatch[1].replace(/\s+/g, ''),
      notes: `PE ${rpeMatch[1].replace(/\s+/g, '')}`,
    };
  }

  const zoneMatch = normalized.match(/\b(Z[1-5])\b/i);
  if (zoneMatch) {
    return {
      metric: 'ZONE',
      value: zoneMatch[1].toUpperCase(),
      notes: `Target ${zoneMatch[1].toUpperCase()}`,
    };
  }

  const bpmMatch = normalized.match(/\b(\d{2,3})\s*bpm\b/i);
  if (bpmMatch) {
    return {
      metric: 'HEART_RATE',
      value: `${bpmMatch[1]} bpm`,
      notes: 'Heart-rate guided work',
    };
  }

  const powerMatch = normalized.match(/\b(\d{2,4})\s*(?:w|watts?)\b/i);
  if (powerMatch) {
    return {
      metric: 'POWER',
      value: `${powerMatch[1]}w`,
      notes: 'Power target',
    };
  }

  if (/\btempo pace\b|\brace pace\b|\beasy pace\b|\bsteady pace\b/i.test(normalized)) {
    const label = normalized.match(/\b(tempo pace|race pace|easy pace|steady pace)\b/i)?.[1] ?? 'pace target';
    return {
      metric: 'PACE',
      value: label.toLowerCase(),
      notes: label,
    };
  }

  return null;
}

function stripTargetText(text: string) {
  return compact(text)
    .replace(/\b(?:PE|RPE)\s*\d(?:\.\d+)?(?:\s*-\s*\d(?:\.\d+)?)?\b/gi, '')
    .replace(/\bZ[1-5]\b/gi, '')
    .replace(/\b\d{2,3}\s*bpm\b/gi, '')
    .replace(/\b\d{2,4}\s*(?:w|watts?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeNote(line: string) {
  return compact(line).replace(/^-\s*/, '').trim();
}

function buildIntervalIntent(text: string) {
  const cleaned = stripTargetText(text).replace(/^[,;:\-\s]+/, '').trim();
  return cleaned || compact(text);
}

function parseIntervals(text: string): SessionRecipeV2['blocks'][number]['intervals'] {
  const normalized = compact(text);
  const intervals: NonNullable<SessionRecipeV2['blocks'][number]['intervals']> = [];

  const parentheticalRegex = /(\d+)\s*[xX]\s*\(([^)]+)\)/g;
  for (const match of normalized.matchAll(parentheticalRegex)) {
    const reps = Number(match[1]);
    if (!Number.isFinite(reps) || reps <= 0) continue;
    const parts = match[2].split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean);
    const work = parseLeadingIntervalToken(parts[0] ?? '');
    const recovery = parts[1] ? parseLeadingIntervalToken(parts[1]) : null;
    intervals.push({
      reps: Math.round(reps),
      on: work?.token ?? compact(parts[0] ?? ''),
      ...(recovery?.token ? { off: recovery.token } : {}),
      intent: buildIntervalIntent(parts[0] ?? ''),
    });
  }

  const inlineRegex = /(\d+)\s*[xX]\s*([\d.]+\s*(?:km|m|mi|miles?|hours?|hrs?|hr|h|minutes?|mins?|min|sec|secs|seconds?)\b[^.;)]*)/g;
  for (const match of normalized.matchAll(inlineRegex)) {
    const reps = Number(match[1]);
    if (!Number.isFinite(reps) || reps <= 0) continue;
    const segment = compact(match[2]);
    const leading = parseLeadingIntervalToken(segment);
    const on = leading?.token ?? segment;
    const intent = buildIntervalIntent(segment);
    const signature = `${reps}:${on}:${intent}`;
    if (intervals.some((entry) => `${entry.reps}:${entry.on}:${entry.intent}` === signature)) continue;
    intervals.push({
      reps: Math.round(reps),
      on,
      intent,
    });
  }

  return intervals.slice(0, 12);
}

function blockKeyFromHeading(line: string): SessionRecipeBlockKey | null {
  const normalized = normalizeNote(line).toLowerCase();
  if (/^(warm[\s-]?up|wu)\b/.test(normalized)) return 'warmup';
  if (/^(cool[\s-]?down|warm[\s-]?down|wd)\b/.test(normalized)) return 'cooldown';
  if (/^(main(?: set| session)?|session|set)\b/.test(normalized)) return 'main';
  if (/^(drill|technique)\b/.test(normalized)) return 'drill';
  if (/^(strength|s&c|conditioning)\b/.test(normalized)) return 'strength';
  return null;
}

function isMetadataLine(line: string) {
  const normalized = normalizeNote(line);
  if (!normalized) return true;
  if (/^(pool|road|track|group ride|treadmill\/road|treadmill\/track|open-water|open water|rest-day|off)$/i.test(normalized)) {
    return true;
  }
  return /^[A-Z0-9/& -]{2,24}$/.test(normalized);
}

function inferPrimaryGoal(params: { discipline: PlanSourceDiscipline; sessionType: string; sessionText: string }): SessionRecipeV2['primaryGoal'] {
  const type = String(params.sessionType || '').toLowerCase();
  const text = compact(params.sessionText).toLowerCase();
  if (type === 'technique' || /\bdrill\b|\btechnique\b/.test(text)) return 'technique-quality';
  if (type === 'threshold' || /\bthreshold\b|\blactate\b/.test(text)) return 'threshold-development';
  if (type === 'tempo' || /\btempo\b/.test(text)) return 'tempo-control';
  if (type === 'easy' || type === 'recovery' || /\brecovery\b|\beasy\b/.test(text)) return 'recovery-absorption';
  if (params.discipline === 'STRENGTH' || /\bstrength\b|\bconditioning\b/.test(text)) return 'strength-resilience';
  if (params.discipline === 'BRICK') return 'race-specificity';
  if (/\brace pace\b|\btime trial\b|\bbrick\b/.test(text)) return 'race-specificity';
  return 'aerobic-durability';
}

function buildDefaultAdjustments(primaryGoal: SessionRecipeV2['primaryGoal']) {
  if (primaryGoal === 'technique-quality') {
    return {
      ifMissed: ['Repeat the session later in the week and keep the drill count unchanged.'],
      ifCooked: ['Keep the drills, shorten the main set, and stay smooth rather than forcing pace.'],
    };
  }

  if (primaryGoal === 'threshold-development' || primaryGoal === 'tempo-control') {
    return {
      ifMissed: ['Keep one key work set and reduce the total volume by around 25%.'],
      ifCooked: ['Drop one repetition and hold the work just below target intensity.'],
    };
  }

  return {
    ifMissed: ['Preserve the main set and trim the total work by around 20%.'],
    ifCooked: ['Keep the warmup and cooldown, then complete the main work one intensity step easier.'],
  };
}

function buildQualityChecks(targets: ParsedTarget[], hasIntervals: boolean) {
  const checks = ['Complete the session in the written block order.'];
  if (targets[0]) checks.push(`Hold the main work near ${targets[0].metric} ${targets[0].value}.`);
  if (hasIntervals) checks.push('Keep the recoveries controlled rather than turning them into extra work.');
  return checks.slice(0, 5);
}

export function parseWorkoutRecipeFromSessionText(params: {
  discipline: PlanSourceDiscipline;
  sessionType: string;
  sessionText: string;
  title?: string | null;
  durationMinutes?: number | null;
}): ParsedWorkoutRecipe {
  const warnings: string[] = [];
  const sessionText = normalizeText(params.sessionText);
  if (!sessionText) {
    return {
      recipeV2: null,
      intensityType: null,
      intensityTargetJson: null,
      estimatedDurationMinutes: params.durationMinutes ?? null,
      warnings: ['Session text was empty.'],
      confidence: 0,
    };
  }

  const lines = sessionText.split(/\r?\n/).map(normalizeNote).filter(Boolean);
  const draftBlocks: DraftBlock[] = [];
  let currentBlock: DraftBlock | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    const key = blockKeyFromHeading(line);
    if (key) {
      if (currentBlock && currentBlock.lines.length) draftBlocks.push(currentBlock);
      currentBlock = { key, lines: [] };
      const remainder = line.replace(/^(warm[\s-]?up|wu|cool[\s-]?down|warm[\s-]?down|wd|main(?: set| session)?|session|set|drill|technique|strength|s&c|conditioning)\b\s*[:.-]?\s*/i, '').trim();
      if (remainder) currentBlock.lines.push(remainder);
      continue;
    }

    if (isMetadataLine(line) && !currentBlock) continue;
    if (currentBlock) currentBlock.lines.push(line);
    else preamble.push(line);
  }
  if (currentBlock && currentBlock.lines.length) draftBlocks.push(currentBlock);

  if (!draftBlocks.length) {
    const mainLines = [...preamble, ...lines.filter((line) => !isMetadataLine(line))];
    draftBlocks.push({ key: params.discipline === 'STRENGTH' ? 'strength' : 'main', lines: Array.from(new Set(mainLines)) });
    warnings.push('No explicit block headings found; generated a single main block.');
  }

  const blockTargets: Array<{ blockKey: SessionRecipeBlockKey; metric: SessionRecipeMetric; value: string; notes?: string }> = [];
  let explicitBlockCount = 0;

  const blocks: SessionRecipeV2['blocks'] = draftBlocks
    .map((block) => {
      if (block.lines.length) explicitBlockCount += 1;
      const joined = block.lines.join(' ');
      const target = parseTarget(joined);
      if (target) {
        blockTargets.push({
          blockKey: block.key,
          metric: target.metric,
          value: target.value,
          ...(target.notes ? { notes: target.notes } : {}),
        });
      }
      const intervals = parseIntervals(joined) ?? [];
      const leadingDuration = parseNumericRangeToMinutes(joined);
      const intervalDuration = intervals.reduce((sum, interval) => {
        const on = parseLeadingIntervalToken(interval.on)?.durationMinutes ?? 0;
        const off = interval.off ? parseLeadingIntervalToken(interval.off)?.durationMinutes ?? 0 : 0;
        return sum + Math.round((on + off) * Number(interval.reps ?? 1));
      }, 0);
      const durationMinutes = leadingDuration ?? (intervalDuration > 0 ? intervalDuration : undefined);
      const notes = Array.from(new Set(block.lines.map(normalizeNote).filter(Boolean))).slice(0, 6);

      return {
        key: block.key,
        ...(durationMinutes && durationMinutes > 0 ? { durationMinutes } : {}),
        ...(target
          ? {
              target: {
                metric: target.metric,
                value: target.value,
                ...(target.notes ? { notes: target.notes } : {}),
              },
            }
          : {}),
        ...(intervals.length ? { intervals } : {}),
        ...(notes.length ? { notes } : {}),
      };
    })
    .filter((block) => block.notes?.length || block.intervals?.length || block.durationMinutes || block.target);

  const estimatedDurationMinutes =
    params.durationMinutes ??
    (() => {
      const total = blocks.reduce((sum, block) => sum + Number(block.durationMinutes ?? 0), 0);
      return total > 0 ? total : parseNumericRangeToMinutes(sessionText);
    })() ??
    null;

  const fallbackTarget = parseTarget(sessionText);
  const primaryTarget = blockTargets[0] ?? (fallbackTarget ? { blockKey: 'main' as const, ...fallbackTarget } : null);
  const primaryGoal = inferPrimaryGoal({
    discipline: params.discipline,
    sessionType: params.sessionType,
    sessionText,
  });

  const recipeCandidate = {
    version: 'v2' as const,
    primaryGoal,
    executionSummary:
      compact(params.title || '') ||
      `${params.discipline.toLowerCase()} ${String(params.sessionType || 'session').toLowerCase()} reference session`,
    blocks: blocks.length
      ? blocks
      : [
          {
            key: params.discipline === 'STRENGTH' ? 'strength' : 'main',
            notes: [compact(sessionText).slice(0, 220)].filter(Boolean),
          },
        ],
    adjustments: buildDefaultAdjustments(primaryGoal),
    qualityChecks: buildQualityChecks(
      primaryTarget ? [{ metric: primaryTarget.metric, value: primaryTarget.value, ...(primaryTarget.notes ? { notes: primaryTarget.notes } : {}) }] : [],
      blocks.some((block) => Array.isArray(block.intervals) && block.intervals.length > 0)
    ),
  };

  const parsedRecipe = sessionRecipeV2Schema.safeParse(recipeCandidate);
  if (!parsedRecipe.success) {
    return {
      recipeV2: null,
      intensityType: primaryTarget?.metric ?? null,
      intensityTargetJson: primaryTarget
        ? {
            primaryTarget: {
              metric: primaryTarget.metric,
              value: primaryTarget.value,
              ...(primaryTarget.notes ? { notes: primaryTarget.notes } : {}),
            },
            ...(blockTargets.length ? { blockTargets } : {}),
          }
        : null,
      estimatedDurationMinutes,
      warnings: [...warnings, 'Structured recipe did not validate.'],
      confidence: 0.2,
    };
  }

  let confidence = 0.25;
  if (explicitBlockCount >= 2) confidence += 0.25;
  if (blockTargets.length) confidence += 0.2;
  if (blocks.some((block) => Array.isArray(block.intervals) && block.intervals.length > 0)) confidence += 0.2;
  if (estimatedDurationMinutes && estimatedDurationMinutes > 0) confidence += 0.1;

  return {
    recipeV2: parsedRecipe.data,
    intensityType: primaryTarget?.metric ?? null,
    intensityTargetJson: primaryTarget
      ? {
          primaryTarget: {
            metric: primaryTarget.metric,
            value: primaryTarget.value,
            ...(primaryTarget.notes ? { notes: primaryTarget.notes } : {}),
          },
          ...(blockTargets.length ? { blockTargets } : {}),
        }
      : null,
    estimatedDurationMinutes,
    warnings,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
  };
}
