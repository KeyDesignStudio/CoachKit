import { sessionRecipeV2Schema, type SessionRecipeV2 } from './session-recipe';
import type { SessionDetailV1 } from './session-detail';

function parseRecipeV2(value: unknown): SessionRecipeV2 | null {
  const direct = sessionRecipeV2Schema.safeParse(value);
  if (direct.success) return direct.data;
  return null;
}

function clampText(value: string | null | undefined, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

function deriveTargetFromDetail(block: SessionDetailV1['structure'][number]) {
  if (typeof block.intensity?.rpe === 'number') {
    return {
      metric: 'RPE' as const,
      value: String(block.intensity.rpe),
      ...(block.intensity.notes ? { notes: block.intensity.notes.slice(0, 260) } : {}),
    };
  }
  if (typeof block.intensity?.zone === 'string') {
    return {
      metric: 'ZONE' as const,
      value: block.intensity.zone,
      ...(block.intensity.notes ? { notes: block.intensity.notes.slice(0, 260) } : {}),
    };
  }
  return undefined;
}

function inferPrimaryGoalFromDetail(detail: SessionDetailV1): SessionRecipeV2['primaryGoal'] {
  const objective = `${detail.objective} ${detail.purpose ?? ''}`.toLowerCase();
  if (/\bdrill|technique|form\b/.test(objective)) return 'technique-quality';
  if (/\bthreshold|tempo|sustain\b/.test(objective)) return 'threshold-development';
  if (/\brecovery|easy\b/.test(objective)) return 'recovery-absorption';
  if (/\brace|brick\b/.test(objective)) return 'race-specificity';
  if (/\bstrength|gym\b/.test(objective)) return 'strength-resilience';
  return 'aerobic-durability';
}

function renderRecipeBlockSteps(block: SessionRecipeV2['blocks'][number]) {
  const parts: string[] = [];
  if (block.intervals?.length) {
    parts.push(
      block.intervals
        .map((interval) => {
          const reps = typeof interval.reps === 'number' ? `${interval.reps} x ` : '';
          const off = interval.off ? ` / ${interval.off}` : '';
          return `${reps}${interval.on}${off}: ${interval.intent}`;
        })
        .join('; ')
    );
  }
  if (block.notes?.length) parts.push(block.notes.join(' '));
  if (block.target?.notes) parts.push(block.target.notes);
  return parts.join(' ').trim() || `${block.key} block`;
}

function recipeTargetToDetailIntensity(target: SessionRecipeV2['blocks'][number]['target']) {
  if (!target) return undefined;
  if (target.metric === 'RPE') {
    const numeric = Number(String(target.value).split(/[^0-9.]+/).find(Boolean));
    return {
      ...(Number.isFinite(numeric) ? { rpe: numeric } : {}),
      ...(target.notes ? { notes: target.notes.slice(0, 200) } : {}),
    };
  }
  if (target.metric === 'ZONE' && /^Z[1-5]$/i.test(target.value)) {
    return {
      zone: target.value.toUpperCase() as 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5',
      ...(target.notes ? { notes: target.notes.slice(0, 200) } : {}),
    };
  }
  return target.notes ? { notes: target.notes.slice(0, 200) } : undefined;
}

export function syncSessionRecipeV2WithDetail(detail: SessionDetailV1): SessionRecipeV2 {
  const existing = parseRecipeV2((detail as any).recipeV2 ?? null);
  const blocks = detail.structure.map((block, index) => {
    const existingBlock =
      existing?.blocks[index]?.key === block.blockType
        ? existing.blocks[index]
        : existing?.blocks.find((candidate) => candidate.key === block.blockType);
    const noteList = Array.from(
      new Set(
        [...(existingBlock?.notes ?? []), clampText(block.steps, 220)]
          .map((entry) => clampText(entry, 220))
          .filter((entry): entry is string => Boolean(entry))
      )
    ).slice(0, 6);

    return {
      key: block.blockType,
      ...(typeof block.durationMinutes === 'number' ? { durationMinutes: block.durationMinutes } : existingBlock?.durationMinutes ? { durationMinutes: existingBlock.durationMinutes } : {}),
      ...(deriveTargetFromDetail(block) ?? existingBlock?.target ? { target: (deriveTargetFromDetail(block) ?? existingBlock?.target)! } : {}),
      ...(existingBlock?.intervals?.length ? { intervals: existingBlock.intervals } : {}),
      ...(noteList.length ? { notes: noteList } : {}),
    };
  });

  return {
    version: 'v2',
    primaryGoal: existing?.primaryGoal ?? inferPrimaryGoalFromDetail(detail),
    executionSummary: (detail.purpose ?? detail.objective).slice(0, 320),
    blocks,
    adjustments:
      existing?.adjustments ?? {
        ifMissed: ['Keep the main work but trim total volume by around 20%.'],
        ifCooked: ['Hold the session one intensity step easier and prioritize smooth execution.'],
      },
    qualityChecks:
      existing?.qualityChecks?.length
        ? existing.qualityChecks.map((entry) => clampText(entry, 220)).slice(0, 5)
        : [detail.targets.notes, ...(detail.cues ?? [])]
            .map((entry) => clampText(entry, 220))
            .filter((entry): entry is string => Boolean(entry))
            .slice(0, 5),
  };
}

export function buildSessionDetailFromReferenceRecipe(params: {
  baseDetail: SessionDetailV1;
  reference: {
    recipeV2: SessionRecipeV2;
    title?: string | null;
    notes?: string | null;
  };
}) {
  const structure = params.reference.recipeV2.blocks.map((block) => ({
    blockType: block.key,
    ...(typeof block.durationMinutes === 'number' ? { durationMinutes: block.durationMinutes } : {}),
    ...(recipeTargetToDetailIntensity(block.target) ? { intensity: recipeTargetToDetailIntensity(block.target)! } : {}),
    steps: renderRecipeBlockSteps(block).slice(0, 1000),
  }));

  const primaryMetric = params.reference.recipeV2.blocks.find((block) => block.target?.metric === 'ZONE' || block.target?.metric === 'RPE')?.target?.metric;
  const cues = Array.from(
    new Set(
      [
        ...(params.baseDetail.cues ?? []),
        params.reference.recipeV2.executionSummary,
        params.reference.title ?? null,
        params.reference.notes ?? null,
      ].filter((entry): entry is string => Boolean(entry))
    )
  ).slice(0, 3);

  const nextDetail: SessionDetailV1 = {
    ...params.baseDetail,
    purpose: params.reference.recipeV2.executionSummary.slice(0, 240),
    structure: structure.length ? structure : params.baseDetail.structure,
    targets: {
      primaryMetric: primaryMetric === 'ZONE' ? 'ZONE' : params.baseDetail.targets.primaryMetric,
      notes: (params.reference.recipeV2.executionSummary || params.baseDetail.targets.notes).slice(0, 500),
    },
    ...(cues.length ? { cues } : {}),
    recipeV2: params.reference.recipeV2,
  };

  return {
    ...nextDetail,
    recipeV2: syncSessionRecipeV2WithDetail(nextDetail),
  };
}
