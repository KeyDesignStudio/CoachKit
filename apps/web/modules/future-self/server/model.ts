export const FUTURE_SELF_MODEL_VERSION = 'future-self-v1';

export type ScenarioKnobs = {
  adherencePct: 70 | 85 | 95;
  volumePct: -10 | 0 | 10;
  intensityMode: 'BASELINE' | 'PLUS_ONE_HARD_SESSION';
  taperDays: 7 | 10 | null;
};

export type ProjectionHorizon = 4 | 8 | 12 | 24;

export type ProjectionInput = {
  athleteId: string;
  sportProfile: {
    disciplines: string[];
    eventName: string | null;
    eventDate: string | null;
  };
  history: {
    historyWeeks: number;
    recentDaysWithTraining: number;
    recentActivities: Array<{
      startTimeIso: string;
      discipline: string;
      durationMinutes: number;
      distanceKm: number | null;
      rpe: number | null;
      avgPowerW: number | null;
    }>;
    plannedSessionsLast28Days: number;
    completedSessionsLast28Days: number;
    runBest5kSec: number | null;
    runBest10kSec: number | null;
    bikeFtpLikeW: number | null;
    checkinsLast30Days: Array<{
      dateIso: string;
      weight: number | null;
      waist: number | null;
    }>;
  };
};

export type PanelConfidence = {
  grade: 'A' | 'B' | 'C';
  reasons: string[];
};

export type ProjectionOutput = {
  modelVersion: string;
  generatedAt: string;
  headline: string;
  horizons: Record<string, {
    performance: {
      run5kSec: { likely: number; low: number; high: number } | null;
      run10kSec: { likely: number; low: number; high: number } | null;
      bikeFtpW: { likely: number; low: number; high: number } | null;
      summary: string;
      confidence: PanelConfidence;
      assumptions: string[];
      dataQuality: PanelConfidence['grade'];
    };
    consistency: {
      baselineAdherencePct: number;
      scenarioAdherencePct: number;
      expectedLoadDeltaPct: number;
      summary: string;
      confidence: PanelConfidence;
      assumptions: string[];
      dataQuality: PanelConfidence['grade'];
    };
    bodyComposition: {
      projectedWeightKg: { likely: number; low: number; high: number } | null;
      projectedWaistCm: { likely: number; low: number; high: number } | null;
      silhouetteEligible: boolean;
      summary: string;
      confidence: PanelConfidence;
      assumptions: string[];
      dataQuality: PanelConfidence['grade'];
    };
    disclaimer: string;
  }>;
  assumptions: {
    recencyDaysUsed: number;
    scenario: ScenarioKnobs;
    notes: string[];
  };
  confidence: {
    overall: PanelConfidence;
    panels: {
      performance: PanelConfidence;
      consistency: PanelConfidence;
      bodyComposition: PanelConfidence;
    };
  };
};

export function confidenceFromSignals(params: {
  historyWeeks: number;
  hasBenchmark: boolean;
  recentDaysWithTraining: number;
}): PanelConfidence {
  if (params.historyWeeks >= 12 && params.hasBenchmark && params.recentDaysWithTraining >= 14) {
    return { grade: 'A', reasons: ['12+ weeks history', 'Recent benchmark present', 'Consistent training frequency'] };
  }

  if (params.historyWeeks >= 6 && (params.hasBenchmark || params.recentDaysWithTraining >= 10)) {
    return { grade: 'B', reasons: ['6+ weeks history', 'Partial benchmark or moderate data consistency'] };
  }

  return { grade: 'C', reasons: ['Sparse history or benchmark data', 'Directional range only'] };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function pctWidthForGrade(grade: PanelConfidence['grade'], horizonWeeks: ProjectionHorizon) {
  const base = grade === 'A' ? 0.02 : grade === 'B' ? 0.04 : 0.07;
  const horizonPenalty = Math.max(0, (horizonWeeks - 4) / 4) * 0.005;
  return clamp(base + horizonPenalty, 0.02, 0.14);
}

function band(value: number, widthPct: number) {
  const low = value * (1 - widthPct);
  const high = value * (1 + widthPct);
  return { low, high };
}

function estimateImprovementPct(params: {
  horizonWeeks: ProjectionHorizon;
  adherencePct: ScenarioKnobs['adherencePct'];
  volumePct: ScenarioKnobs['volumePct'];
  intensityMode: ScenarioKnobs['intensityMode'];
  recentLoadDeltaPct: number;
}) {
  const timeFactor = params.horizonWeeks / 4;
  const adherenceFactor = params.adherencePct / 85;
  const volumeFactor = 1 + params.volumePct / 100;
  const intensityFactor = params.intensityMode === 'PLUS_ONE_HARD_SESSION' ? 1.08 : 1;
  const loadFactor = clamp(1 + params.recentLoadDeltaPct / 100, 0.85, 1.15);

  const pct = 0.01 * timeFactor * adherenceFactor * volumeFactor * intensityFactor * loadFactor;
  return clamp(pct, 0, 0.1);
}

function estimateWeightWeeklyDeltaKg(weights: Array<{ t: number; w: number }>) {
  if (weights.length < 2) return 0;
  const n = weights.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;

  for (const point of weights) {
    sx += point.t;
    sy += point.w;
    sxx += point.t * point.t;
    sxy += point.t * point.w;
  }

  const denominator = n * sxx - sx * sx;
  if (denominator === 0) return 0;

  const slopePerDay = (n * sxy - sx * sy) / denominator;
  return clamp(slopePerDay * 7, -1, 1);
}

function summaryForPerformance(params: {
  run10k: { low: number; high: number } | null;
  bikeFtp: { low: number; high: number } | null;
  horizonWeeks: ProjectionHorizon;
}) {
  if (params.run10k) {
    return `Likely 10k range by ${params.horizonWeeks} weeks: ${formatSeconds(params.run10k.low)}-${formatSeconds(params.run10k.high)}.`;
  }
  if (params.bikeFtp) {
    return `Likely FTP range by ${params.horizonWeeks} weeks: ${Math.round(params.bikeFtp.low)}-${Math.round(params.bikeFtp.high)} W.`;
  }
  return 'Not enough recent benchmark data. Showing directional guidance only.';
}

export function formatSeconds(totalSec: number) {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function buildProjection(input: ProjectionInput, scenario: ScenarioKnobs, selectedHorizon: ProjectionHorizon): ProjectionOutput {
  const now = new Date().toISOString();
  const horizons: ProjectionHorizon[] = [4, 8, 12, 24];

  const baselineAdherencePct = input.history.plannedSessionsLast28Days > 0
    ? Math.round((input.history.completedSessionsLast28Days / input.history.plannedSessionsLast28Days) * 100)
    : 0;

  const totalRecentLoad = input.history.recentActivities.reduce((sum, item) => {
    const rpeFactor = item.rpe != null ? clamp(0.55 + item.rpe * 0.07, 0.6, 1.3) : 1;
    return sum + item.durationMinutes * rpeFactor;
  }, 0);

  const recentLoadDeltaPct = input.history.recentActivities.length > 0
    ? clamp(((totalRecentLoad / input.history.recentActivities.length) - 50) / 50 * 20, -20, 20)
    : 0;

  const performanceConfidence = confidenceFromSignals({
    historyWeeks: input.history.historyWeeks,
    hasBenchmark: Boolean(input.history.runBest10kSec || input.history.runBest5kSec || input.history.bikeFtpLikeW),
    recentDaysWithTraining: input.history.recentDaysWithTraining,
  });

  const consistencyConfidence = confidenceFromSignals({
    historyWeeks: input.history.historyWeeks,
    hasBenchmark: input.history.plannedSessionsLast28Days >= 8,
    recentDaysWithTraining: input.history.recentDaysWithTraining,
  });

  const bodyConfidence = confidenceFromSignals({
    historyWeeks: input.history.historyWeeks,
    hasBenchmark: input.history.checkinsLast30Days.filter((d) => d.weight != null).length >= 3,
    recentDaysWithTraining: input.history.recentDaysWithTraining,
  });

  const outputByHorizon = Object.fromEntries(
    horizons.map((horizonWeeks) => {
      const improvementPct = estimateImprovementPct({
        horizonWeeks,
        adherencePct: scenario.adherencePct,
        volumePct: scenario.volumePct,
        intensityMode: scenario.intensityMode,
        recentLoadDeltaPct,
      });

      const perfWidth = pctWidthForGrade(performanceConfidence.grade, horizonWeeks);
      const bodyWidth = pctWidthForGrade(bodyConfidence.grade, horizonWeeks);

      const run5kLikely = input.history.runBest5kSec ? input.history.runBest5kSec * (1 - improvementPct) : null;
      const run10kLikely = input.history.runBest10kSec ? input.history.runBest10kSec * (1 - improvementPct) : null;
      const ftpLikely = input.history.bikeFtpLikeW ? input.history.bikeFtpLikeW * (1 + improvementPct * 0.8) : null;

      const run5kBand = run5kLikely != null ? band(run5kLikely, perfWidth) : null;
      const run10kBand = run10kLikely != null ? band(run10kLikely, perfWidth) : null;
      const ftpBand = ftpLikely != null ? band(ftpLikely, perfWidth) : null;

      const checkins = input.history.checkinsLast30Days
        .filter((item) => item.weight != null)
        .map((item) => ({ item, date: new Date(item.dateIso) }))
        .filter((item) => !Number.isNaN(item.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      const lastWeight = checkins.length > 0 ? checkins[checkins.length - 1].item.weight : null;
      const firstDate = checkins.length > 0 ? checkins[0].date.getTime() : null;
      const weightsForRegression = firstDate != null
        ? checkins.map(({ item, date }) => ({
            t: (date.getTime() - firstDate) / (1000 * 60 * 60 * 24),
            w: Number(item.weight),
          }))
        : [];

      const weeklyWeightDelta = estimateWeightWeeklyDeltaKg(weightsForRegression);
      const projectedWeightLikely = lastWeight != null
        ? lastWeight + weeklyWeightDelta * (horizonWeeks / 1)
        : null;
      const projectedWeightBand = projectedWeightLikely != null ? band(projectedWeightLikely, bodyWidth) : null;

      const latestWaist = input.history.checkinsLast30Days.find((c) => c.waist != null)?.waist ?? null;
      const projectedWaistLikely = latestWaist != null && projectedWeightLikely != null && lastWeight != null
        ? latestWaist + (projectedWeightLikely - lastWeight) * 1.1
        : null;
      const projectedWaistBand = projectedWaistLikely != null ? band(projectedWaistLikely, bodyWidth) : null;

      const consistencyLoadDelta = Math.round((scenario.adherencePct - baselineAdherencePct) * 0.6 + scenario.volumePct);

      const horizonOutput = {
        performance: {
          run5kSec: run5kLikely != null && run5kBand
            ? { likely: run5kLikely, low: run5kBand.low, high: run5kBand.high }
            : null,
          run10kSec: run10kLikely != null && run10kBand
            ? { likely: run10kLikely, low: run10kBand.low, high: run10kBand.high }
            : null,
          bikeFtpW: ftpLikely != null && ftpBand
            ? { likely: ftpLikely, low: ftpBand.low, high: ftpBand.high }
            : null,
          summary: summaryForPerformance({
            run10k: run10kBand,
            bikeFtp: ftpBand,
            horizonWeeks,
          }),
          confidence: performanceConfidence,
          assumptions: [
            `Adherence assumed at ${scenario.adherencePct}%`,
            `Volume adjustment ${scenario.volumePct > 0 ? '+' : ''}${scenario.volumePct}%`,
            `Intensity mode: ${scenario.intensityMode === 'PLUS_ONE_HARD_SESSION' ? 'plus one hard session/week' : 'baseline'}`,
          ],
          dataQuality: performanceConfidence.grade,
        },
        consistency: {
          baselineAdherencePct,
          scenarioAdherencePct: scenario.adherencePct,
          expectedLoadDeltaPct: consistencyLoadDelta,
          summary:
            `If consistency stays near ${scenario.adherencePct}%, expected training stimulus is about ${consistencyLoadDelta >= 0 ? '+' : ''}${consistencyLoadDelta}% vs recent baseline.`,
          confidence: consistencyConfidence,
          assumptions: [
            'Recent 28-day completion ratio used as baseline adherence.',
            'Missed sessions reduce adaptation potential proportionally.',
          ],
          dataQuality: consistencyConfidence.grade,
        },
        bodyComposition: {
          projectedWeightKg: projectedWeightLikely != null && projectedWeightBand
            ? { likely: projectedWeightLikely, low: projectedWeightBand.low, high: projectedWeightBand.high }
            : null,
          projectedWaistCm: projectedWaistLikely != null && projectedWaistBand
            ? { likely: projectedWaistLikely, low: projectedWaistBand.low, high: projectedWaistBand.high }
            : null,
          silhouetteEligible: Boolean(projectedWeightLikely != null && projectedWaistLikely != null),
          summary: projectedWeightLikely != null
            ? `Weight trend estimate by ${horizonWeeks} weeks: ${projectedWeightBand?.low.toFixed(1)}-${projectedWeightBand?.high.toFixed(1)} kg.`
            : 'Not enough check-ins for a weight trend projection yet.',
          confidence: bodyConfidence,
          assumptions: [
            'Weight trend uses recent check-ins with regression-to-mean bounds.',
            'Maximum weekly change clamped to safe limits.',
          ],
          dataQuality: bodyConfidence.grade,
        },
        disclaimer: 'Projections are estimates, not guarantees.',
      };

      return [String(horizonWeeks), horizonOutput];
    })
  ) as ProjectionOutput['horizons'];

  const selected = outputByHorizon[String(selectedHorizon)] ?? outputByHorizon['12'];

  const headline = selected.performance.run10kSec
    ? `Likely 10k: ${formatSeconds(selected.performance.run10kSec.low)}-${formatSeconds(selected.performance.run10kSec.high)} by ${selectedHorizon} weeks`
    : selected.performance.bikeFtpW
      ? `Likely FTP: ${Math.round(selected.performance.bikeFtpW.low)}-${Math.round(selected.performance.bikeFtpW.high)} W by ${selectedHorizon} weeks`
      : `Directional projection ready for ${selectedHorizon} weeks`;

  return {
    modelVersion: FUTURE_SELF_MODEL_VERSION,
    generatedAt: now,
    headline,
    horizons: outputByHorizon,
    assumptions: {
      recencyDaysUsed: 84,
      scenario,
      notes: [
        'Simple explainable response curves; no black-box model in V1.',
        'Confidence widens with sparse benchmarks and shorter history.',
      ],
    },
    confidence: {
      overall: confidenceFromSignals({
        historyWeeks: input.history.historyWeeks,
        hasBenchmark: Boolean(input.history.runBest10kSec || input.history.runBest5kSec || input.history.bikeFtpLikeW),
        recentDaysWithTraining: input.history.recentDaysWithTraining,
      }),
      panels: {
        performance: performanceConfidence,
        consistency: consistencyConfidence,
        bodyComposition: bodyConfidence,
      },
    },
  };
}
