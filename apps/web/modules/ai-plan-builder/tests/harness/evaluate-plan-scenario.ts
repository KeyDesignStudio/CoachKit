import { evaluateDraftQualityGate } from '@/modules/ai-plan-builder/rules/constraint-validator';
import { generateDraftPlanDeterministicV1, type DraftPlanSetupV1, type DraftPlanV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

export type PhaseCScenarioMetrics = {
  hardViolationCount: number;
  softWarningCount: number;
  qualityScore: number;
  weeklyMinutesInBandRate: number;
  keySessionBandPassRate: number;
  nonConsecutiveIntensityRate: number;
  noLongThenIntensityRate: number;
  taperLastWeekDeltaMinutes: number | null;
};

export type PhaseCScenarioEvaluation = {
  setup: DraftPlanSetupV1;
  draft: DraftPlanV1;
  metrics: PhaseCScenarioMetrics;
  hardViolationCodes: string[];
  softWarningCodes: string[];
  regressionSummary: {
    weeks: Array<{
      weekIndex: number;
      totalMinutes: number;
      sessionCount: number;
      keySessions: number;
      intensityDays: number;
    }>;
  };
};

function weekRows(draft: DraftPlanV1) {
  return (draft.weeks ?? []).map((w) => {
    const sessions = Array.isArray(w.sessions) ? w.sessions : [];
    const totalMinutes = sessions.reduce((sum, s) => sum + Math.max(0, Number(s.durationMinutes ?? 0)), 0);
    const keySessions = sessions.filter((s) => {
      const notes = String(s.notes ?? '').toLowerCase();
      return s.type === 'tempo' || s.type === 'threshold' || notes.includes('key session') || notes.includes('long run') || notes.includes('long ride') || notes.includes('brick');
    }).length;
    const intensityDays = new Set(
      sessions.filter((s) => s.type === 'tempo' || s.type === 'threshold').map((s) => Number(s.dayOfWeek ?? 0))
    ).size;
    return {
      weekIndex: w.weekIndex,
      sessions,
      totalMinutes,
      sessionCount: sessions.length,
      keySessions,
      intensityDays,
    };
  });
}

function scoreRates(params: { draft: DraftPlanV1; setup: DraftPlanSetupV1 }) {
  const rows = weekRows(params.draft);
  const totalWeeks = Math.max(1, rows.length);

  let inBand = 0;
  let keyBandPass = 0;
  let nonConsecutiveIntensity = 0;
  let noLongThenIntensity = 0;

  for (const row of rows) {
    const target = Array.isArray(params.setup.weeklyMinutesByWeek)
      ? Number(params.setup.weeklyMinutesByWeek[row.weekIndex] ?? params.setup.weeklyAvailabilityMinutes)
      : Number(params.setup.weeklyAvailabilityMinutes);
    const minBound = Math.floor(target * 0.5);
    const maxBound = Math.ceil(target * 1.2);
    if (row.totalMinutes >= minBound && row.totalMinutes <= maxBound) inBand += 1;

    const maxKey = params.setup.riskTolerance === 'high' ? 4 : 3;
    const minKey = params.setup.riskTolerance === 'low' ? 2 : 2;
    if (row.keySessions >= minKey && row.keySessions <= maxKey) keyBandPass += 1;

    const intensityDays = row.sessions
      .filter((s) => s.type === 'tempo' || s.type === 'threshold')
      .map((s) => Number(s.dayOfWeek ?? 0))
      .sort((a, b) => a - b);
    const hasConsecutive = intensityDays.some((d, i) => i > 0 && d - intensityDays[i - 1]! <= 1);
    if (!hasConsecutive) nonConsecutiveIntensity += 1;

    const longDays = row.sessions
      .filter((s) => /\blong run\b|\blong ride\b|\bbrick\b/i.test(String(s.notes ?? '')))
      .map((s) => Number(s.dayOfWeek ?? 0));
    const hasLongThenIntensity = longDays.some((day) =>
      row.sessions.some((s) => (s.type === 'tempo' || s.type === 'threshold') && Number(s.dayOfWeek ?? 0) === day + 1)
    );
    if (!hasLongThenIntensity) noLongThenIntensity += 1;
  }

  const taperLastWeekDeltaMinutes =
    rows.length >= 2 ? rows[rows.length - 1]!.totalMinutes - rows[rows.length - 2]!.totalMinutes : null;

  return {
    weeklyMinutesInBandRate: inBand / totalWeeks,
    keySessionBandPassRate: keyBandPass / totalWeeks,
    nonConsecutiveIntensityRate: nonConsecutiveIntensity / totalWeeks,
    noLongThenIntensityRate: noLongThenIntensity / totalWeeks,
    taperLastWeekDeltaMinutes,
  };
}

export function evaluatePhaseCScenario(setup: DraftPlanSetupV1): PhaseCScenarioEvaluation {
  const draft = generateDraftPlanDeterministicV1(setup);
  const quality = evaluateDraftQualityGate({ setup: draft.setup, draft });
  const rates = scoreRates({ draft, setup: draft.setup });
  const rows = weekRows(draft);

  return {
    setup: draft.setup,
    draft,
    metrics: {
      hardViolationCount: quality.hardViolations.length,
      softWarningCount: quality.softWarnings.length,
      qualityScore: quality.score,
      ...rates,
    },
    hardViolationCodes: Array.from(new Set(quality.hardViolations.map((v) => v.code))),
    softWarningCodes: Array.from(new Set(quality.softWarnings.map((v) => v.code))),
    regressionSummary: {
      weeks: rows.map((r) => ({
        weekIndex: r.weekIndex,
        totalMinutes: r.totalMinutes,
        sessionCount: r.sessionCount,
        keySessions: r.keySessions,
        intensityDays: r.intensityDays,
      })),
    },
  };
}

