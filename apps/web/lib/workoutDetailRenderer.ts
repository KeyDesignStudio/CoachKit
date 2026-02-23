import { sessionDetailV1Schema, type SessionDetailV1 } from '@/modules/ai-plan-builder/rules/session-detail';
import type { SessionRecipeV2 } from '@/modules/ai-plan-builder/rules/session-recipe';

function formatBlockLabel(blockType: SessionDetailV1['structure'][number]['blockType']): string {
  switch (blockType) {
    case 'warmup':
      return 'WARMUP';
    case 'main':
      return 'MAIN';
    case 'cooldown':
      return 'COOLDOWN';
    case 'drill':
      return 'DRILL';
    case 'strength':
      return 'STRENGTH';
    default:
      return String(blockType ?? '').trim().toUpperCase() || 'SESSION';
  }
}

function formatRecipeInterval(interval: SessionRecipeV2['blocks'][number]['intervals'][number]): string {
  const lead = interval.reps ? `${interval.reps} x ${interval.on}` : interval.on;
  const withRest = interval.off ? `${lead}, ${interval.off}` : lead;
  return `${withRest}. ${interval.intent}`;
}

function formatRecipeBlockSteps(block: SessionRecipeV2['blocks'][number]): string {
  const parts: string[] = [];
  if (Array.isArray(block.intervals) && block.intervals.length) {
    parts.push(block.intervals.map((interval) => formatRecipeInterval(interval)).join(' '));
  }
  if (Array.isArray(block.notes) && block.notes.length) {
    parts.push(block.notes.join(' '));
  }
  return parts.join(' ').trim();
}

function toIntMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function stripDurationTokens(value: string): string {
  return value
    .replace(/\(\s*\d+\s*min(?:s|utes)?\s*\)\.?/gi, '')
    .replace(/\b\d+\s*min(?:s|utes)?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function assertNormalizedSessionDetailMatchesTotal(params: {
  detail: SessionDetailV1;
  totalMinutes: number;
  incrementMinutes?: number;
}): void {
  const inc = Math.max(1, Math.round(params.incrementMinutes ?? 5));
  const total = Math.max(0, Math.round(params.totalMinutes));

  if (total % inc !== 0) {
    throw new Error(`Total duration must be in ${inc}-minute increments.`);
  }

  const durations = params.detail.structure.map((b) => toIntMinutes((b as any)?.durationMinutes));
  const sum = durations.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    throw new Error(`Block durations must sum to ${total} minutes (got ${sum}).`);
  }

  for (const d of durations) {
    if (d % inc !== 0) {
      throw new Error(`Block durations must be in ${inc}-minute increments.`);
    }
  }
}

export function renderWorkoutDetailFromSessionDetailV1(detail: SessionDetailV1): string {
  const objective = stripDurationTokens(String(detail.objective ?? '').trim());
  const purpose = String((detail as any).purpose ?? detail.recipeV2?.executionSummary ?? '').trim();
  const recipeBlocks = Array.isArray(detail.recipeV2?.blocks) ? detail.recipeV2.blocks : [];

  const blockLines =
    recipeBlocks.length > 0
      ? recipeBlocks
          .map((block) => {
            const label = formatBlockLabel(block.key as SessionDetailV1['structure'][number]['blockType']);
            const duration = toIntMinutes(block.durationMinutes);
            const steps = formatRecipeBlockSteps(block);
            if (!steps) return null;
            return `${label}: ${duration} min – ${steps}`;
          })
          .filter((x): x is string => Boolean(x))
      : (detail.structure ?? [])
          .map((block) => {
            const label = formatBlockLabel(block.blockType);
            const duration = toIntMinutes((block as any)?.durationMinutes);
            const steps = String((block as any)?.steps ?? '').trim();
            if (!steps) return null;
            return `${label}: ${duration} min – ${steps}`;
          })
          .filter((x): x is string => Boolean(x));

  const lines: string[] = [];
  if (objective) lines.push(objective);
  if (purpose) lines.push(purpose);
  if (blockLines.length) {
    if (lines.length) lines.push('');
    lines.push(...blockLines);
  }
  const explainability = (detail as any).explainability as
    | { whyThis?: string; whyToday?: string; unlocksNext?: string; ifMissed?: string; ifCooked?: string }
    | undefined;
  if (explainability || detail.recipeV2?.adjustments || detail.recipeV2?.executionSummary) {
    const recipeMissed = String(detail.recipeV2?.adjustments?.ifMissed?.[0] ?? '').trim();
    const recipeCooked = String(detail.recipeV2?.adjustments?.ifCooked?.[0] ?? '').trim();
    const whyThis = String(explainability?.whyThis ?? detail.recipeV2?.executionSummary ?? '').trim();
    const whyToday = String(explainability?.whyToday ?? '').trim();
    const ifMissed = String(recipeMissed || explainability?.ifMissed || '').trim();
    const ifCooked = String(recipeCooked || explainability?.ifCooked || '').trim();
    if (whyThis || whyToday || ifMissed || ifCooked) {
      if (lines.length) lines.push('');
      if (whyThis) lines.push(`WHY THIS: ${whyThis}`);
      if (whyToday) lines.push(`WHY TODAY: ${whyToday}`);
      if (ifMissed) lines.push(`IF MISSED: ${ifMissed}`);
      if (ifCooked) lines.push(`IF COOKED: ${ifCooked}`);
    }
  }

  return lines.join('\n').trim();
}

export function tryRenderWorkoutDetailFromDetailJson(detailJson: unknown): string | null {
  const parsed = sessionDetailV1Schema.safeParse(detailJson);
  if (!parsed.success) return null;
  const rendered = renderWorkoutDetailFromSessionDetailV1(parsed.data);
  return rendered || null;
}

export function getWorkoutDetailTextFromCalendarItem(params: {
  workoutDetail?: string | null;
  workoutStructure?: unknown | null;
}): string | null {
  const direct = typeof params.workoutDetail === 'string' ? params.workoutDetail.trim() : '';
  if (direct) return direct;

  const rendered = tryRenderWorkoutDetailFromDetailJson(params.workoutStructure);
  return rendered || null;
}
