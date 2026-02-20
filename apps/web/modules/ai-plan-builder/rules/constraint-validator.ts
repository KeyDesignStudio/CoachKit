import type { DraftPlanV1, DraftPlanSetupV1, DraftWeekV1 } from './draft-generator';

export type DraftConstraintViolation = {
  code:
    | 'OFF_DAY_SESSION'
    | 'MAX_DOUBLES_EXCEEDED'
    | 'MAX_INTENSITY_DAYS_EXCEEDED'
    | 'WEEKLY_MINUTES_OUT_OF_BOUNDS'
    | 'BEGINNER_RUN_CAP_EXCEEDED'
    | 'BEGINNER_BRICK_TOO_EARLY';
  message: string;
  weekIndex: number;
  sessionId?: string;
};

function weeklyMinutesTarget(setup: DraftPlanSetupV1, weekIndex: number): number {
  if (Array.isArray(setup.weeklyMinutesByWeek) && Number.isFinite(setup.weeklyMinutesByWeek[weekIndex])) {
    return Math.max(0, Math.round(Number(setup.weeklyMinutesByWeek[weekIndex])));
  }

  if (typeof setup.weeklyAvailabilityMinutes === 'number') {
    return Math.max(0, Math.round(setup.weeklyAvailabilityMinutes));
  }

  return Object.values(setup.weeklyAvailabilityMinutes ?? {}).reduce((sum, v) => {
    const n = Number(v);
    return sum + (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  }, 0);
}

function isBeginner(setup: DraftPlanSetupV1): boolean {
  const guidance = String(setup.coachGuidanceText ?? '').toLowerCase();
  if (setup.programPolicy === 'COUCH_TO_5K' || setup.programPolicy === 'COUCH_TO_IRONMAN_26') return true;
  if (setup.riskTolerance === 'low') return true;
  return /\bbeginner\b|\bnovice\b|\bcouch\b/.test(guidance);
}

function hasInjuryOrPainSignal(setup: DraftPlanSetupV1): boolean {
  const guidance = String(setup.coachGuidanceText ?? '').toLowerCase();
  return /\binjury\b|\bpain\b|\bsplint\b|\bachilles\b|\bknee\b|\bcalf\b|\bhamstring\b/.test(guidance);
}

function hasTravelConstraintSignal(setup: DraftPlanSetupV1): boolean {
  const guidance = String(setup.coachGuidanceText ?? '').toLowerCase();
  return /\btravel\b|\btravell(?:ing)?\b|\bbusiness trip\b|\baway\b/.test(guidance);
}

function minuteBandRatios(params: {
  setup: DraftPlanSetupV1;
  weekIndex: number;
  beginner: boolean;
}): { minRatio: number; maxRatio: number } {
  const injuryOrPain = hasInjuryOrPainSignal(params.setup);
  const travel = hasTravelConstraintSignal(params.setup);

  if (injuryOrPain || travel) {
    return { minRatio: 0.4, maxRatio: 1.2 };
  }

  if (params.beginner && params.weekIndex < 4) {
    return { minRatio: 0.45, maxRatio: 1.2 };
  }

  return { minRatio: 0.5, maxRatio: 1.15 };
}

export function validateDraftPlanAgainstSetup(params: {
  setup: DraftPlanSetupV1;
  draft: DraftPlanV1;
}): DraftConstraintViolation[] {
  const { setup, draft } = params;
  const allowedDays = new Set((setup.weeklyAvailabilityDays ?? []).map((d) => Number(d)));
  const maxDoubles = Math.max(0, Math.min(3, Number(setup.maxDoublesPerWeek ?? 0)));
  const maxIntensity = Math.max(1, Math.min(3, Number(setup.maxIntensityDaysPerWeek ?? 1)));
  const beginner = isBeginner(setup);
  const violations: DraftConstraintViolation[] = [];

  for (const week of draft.weeks ?? []) {
    const sessions = Array.isArray(week.sessions) ? week.sessions : [];
    const perDay = new Map<number, DraftWeekV1['sessions'][number][]>();
    const intensityDays = new Set<number>();
    let totalWeekMinutes = 0;

    for (const session of sessions) {
      const day = Number(session.dayOfWeek);
      if (!allowedDays.has(day)) {
        violations.push({
          code: 'OFF_DAY_SESSION',
          message: `Week ${week.weekIndex + 1}: session scheduled on unavailable day (${day}).`,
          weekIndex: week.weekIndex,
          sessionId: `${week.weekIndex}:${session.ordinal}`,
        });
      }

      const bucket = perDay.get(day) ?? [];
      bucket.push(session);
      perDay.set(day, bucket);
      totalWeekMinutes += Math.max(0, Number(session.durationMinutes ?? 0));

      if (session.type === 'tempo' || session.type === 'threshold') {
        intensityDays.add(day);
      }

      if (beginner) {
        if (week.weekIndex < 4 && session.discipline === 'run' && Number(session.durationMinutes ?? 0) > 55) {
          violations.push({
            code: 'BEGINNER_RUN_CAP_EXCEEDED',
            message: `Week ${week.weekIndex + 1}: beginner run exceeds cap (55 min) on day ${day}.`,
            weekIndex: week.weekIndex,
            sessionId: `${week.weekIndex}:${session.ordinal}`,
          });
        }

        if (week.weekIndex < 4 && /\bbrick\b/i.test(String(session.notes ?? ''))) {
          violations.push({
            code: 'BEGINNER_BRICK_TOO_EARLY',
            message: `Week ${week.weekIndex + 1}: beginner brick session appears too early.`,
            weekIndex: week.weekIndex,
            sessionId: `${week.weekIndex}:${session.ordinal}`,
          });
        }
      }
    }

    const doublesUsed = Array.from(perDay.values()).filter((rows) => rows.length > 1).length;
    if (doublesUsed > maxDoubles) {
      violations.push({
        code: 'MAX_DOUBLES_EXCEEDED',
        message: `Week ${week.weekIndex + 1}: doubles used ${doublesUsed}, max allowed ${maxDoubles}.`,
        weekIndex: week.weekIndex,
      });
    }

    if (intensityDays.size > maxIntensity) {
      violations.push({
        code: 'MAX_INTENSITY_DAYS_EXCEEDED',
        message: `Week ${week.weekIndex + 1}: intensity days ${intensityDays.size}, max allowed ${maxIntensity}.`,
        weekIndex: week.weekIndex,
      });
    }

    const expected = weeklyMinutesTarget(setup, week.weekIndex);
    if (expected > 0) {
      const ratios = minuteBandRatios({ setup, weekIndex: week.weekIndex, beginner });
      const minBound = Math.floor(expected * ratios.minRatio);
      const maxBound = Math.ceil(expected * ratios.maxRatio);
      if (totalWeekMinutes < minBound || totalWeekMinutes > maxBound) {
        violations.push({
          code: 'WEEKLY_MINUTES_OUT_OF_BOUNDS',
          message: `Week ${week.weekIndex + 1}: planned ${totalWeekMinutes} min outside expected band ${minBound}-${maxBound} min (target ${expected}).`,
          weekIndex: week.weekIndex,
        });
      }
    }
  }

  return violations;
}
