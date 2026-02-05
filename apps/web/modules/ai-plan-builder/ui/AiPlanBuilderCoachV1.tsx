import type { PlanReasoningV1 } from '@/lib/ai/plan-reasoning/types';
/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

import { ApiClientError, useApi } from '@/components/api-client';

import { DAY_NAMES_SUN0, dayOffsetFromWeekStart, daySortKey, normalizeWeekStart, orderedDayIndices } from '../lib/week-start';
import { sessionDetailV1Schema } from '../rules/session-detail';
import { renderWorkoutDetailFromSessionDetailV1 } from '@/lib/workoutDetailRenderer';
import { addDaysToDayKey, getTodayDayKey, isDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';

type SetupState = {
  weekStart: 'monday' | 'sunday';
  startDate: string;
  // Stored as legacy `eventDate` in setupJson for backward compatibility.
  completionDate: string;
  weeksToEventOverride: number | null;
  weeklyAvailabilityDays: number[];
  weeklyAvailabilityMinutes: number;
  disciplineEmphasis: 'balanced' | 'swim' | 'bike' | 'run';
  riskTolerance: 'low' | 'med' | 'high';
  maxIntensityDaysPerWeek: number;
  maxDoublesPerWeek: number;
  longSessionDay: number | null;
  coachGuidanceText: string;
};

function formatApiErrorMessage(e: ApiClientError): string {
  if (e.status === 429 && e.code === 'LLM_RATE_LIMITED') {
    return 'Temporarily unavailable — using a fallback.';
  }
  if (e.code === 'CONFIG_MISSING') {
    return 'Temporarily unavailable — using a fallback.';
  }
  if (e.code === 'WEEK_LOCKED') {
    return 'This week is locked. Unlock it to make changes.';
  }
  if (e.code === 'SESSION_LOCKED') {
    return 'This session is locked. Unlock it to make changes.';
  }
  return 'Something went wrong.';
}

function humanizeEnumLabel(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return cleaned || null;
}

function humanizeDiscipline(value: unknown): string | null {
  const v = value == null ? '' : String(value).trim().toUpperCase();
  if (!v) return null;
  const map: Record<string, string> = {
    RUN: 'Run',
    BIKE: 'Bike',
    CYCLE: 'Bike',
    SWIM: 'Swim',
    STRENGTH: 'Strength',
    GYM: 'Strength',
    ROW: 'Row',
    HIKE: 'Hike',
    WALK: 'Walk',
    OTHER: 'Other',
  };
  return map[v] ?? humanizeEnumLabel(v);
}

function humanizeTrainingFrequency(value: unknown): string | null {
  const v = value == null ? '' : String(value).trim().toUpperCase();
  if (!v) return null;
  const map: Record<string, string> = {
    WEEKLY: 'Weekly',
    FORTNIGHTLY: 'Fortnightly',
    BIWEEKLY: 'Fortnightly',
    MONTHLY: 'Monthly',
    AD_HOC: 'As needed',
  };
  return map[v] ?? null;
}

function humanizeWeekOfMonth(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper === 'LAST') return 'Last';
  if (upper === 'FIRST') return '1st';
  if (upper === 'SECOND') return '2nd';
  if (upper === 'THIRD') return '3rd';
  if (upper === 'FOURTH') return '4th';

  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function humanizeDayOfWeek(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === 'number' && Number.isInteger(value)) {
    return DAY_NAMES_SUN0[value] ?? null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && String(asInt) === raw && Number.isInteger(asInt)) {
    return DAY_NAMES_SUN0[asInt] ?? null;
  }

  const normalized = raw.replace(/\s+/g, '').replace(/[-_]/g, '').toUpperCase();
  const map: Record<string, string> = {
    SUN: 'Sunday',
    SUNDAY: 'Sunday',
    MON: 'Monday',
    MONDAY: 'Monday',
    TUE: 'Tuesday',
    TUES: 'Tuesday',
    TUESDAY: 'Tuesday',
    WED: 'Wednesday',
    WEDNESDAY: 'Wednesday',
    THU: 'Thursday',
    THUR: 'Thursday',
    THURS: 'Thursday',
    THURSDAY: 'Thursday',
    FRI: 'Friday',
    FRIDAY: 'Friday',
    SAT: 'Saturday',
    SATURDAY: 'Saturday',
  };
  return map[normalized] ?? null;
}

function stableDayList(days: number[]): number[] {
  return Array.from(new Set(days)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
}

function startOfWeekDayKeyWithWeekStart(dayKey: string, weekStart: 'monday' | 'sunday'): string {
  if (!isDayKey(dayKey)) return dayKey;
  const date = parseDayKeyToUtcDate(dayKey);
  const jsDay = date.getUTCDay();
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  return addDaysToDayKey(dayKey, -diff);
}

function deriveWeeksToCompletionFromDates(params: {
  startDate: string;
  completionDate: string;
  weekStart: 'monday' | 'sunday';
}): number | null {
  if (!isDayKey(params.startDate) || !isDayKey(params.completionDate)) return null;
  const startWeek = startOfWeekDayKeyWithWeekStart(params.startDate, params.weekStart);
  const endWeek = startOfWeekDayKeyWithWeekStart(params.completionDate, params.weekStart);
  if (!isDayKey(startWeek) || !isDayKey(endWeek)) return null;
  const start = parseDayKeyToUtcDate(startWeek);
  const end = parseDayKeyToUtcDate(endWeek);
  const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const weeks = Math.floor(diffDays / 7) + 1;
  return Math.max(1, Math.min(52, weeks));
}

function formatDayKeyShort(dayKey: string): string {
  if (!isDayKey(dayKey)) return String(dayKey ?? '');
  const d = parseDayKeyToUtcDate(dayKey);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dow = dayNames[d.getUTCDay()] ?? '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = monthNames[d.getUTCMonth()] ?? '';
  return `${dow} ${dd} ${mon}`.trim();
}

export function AiPlanBuilderCoachV1({ athleteId }: { athleteId: string }) {
  const { request } = useApi();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [briefLatest, setBriefLatest] = useState<any | null>(null);
  const [draftPlanLatest, setDraftPlanLatest] = useState<any | null>(null);
  const [publishStatus, setPublishStatus] = useState<any | null>(null);

  const [sessionDraftEdits, setSessionDraftEdits] = useState<
    Record<
      string,
      {
        durationMinutes?: string;
        notes?: string;
        discipline?: string;
        type?: string;
        objective?: string;
        blockSteps?: Record<number, string>;
      }
    >
  >({});

  const [setup, setSetup] = useState<SetupState>(() => ({
    weekStart: 'monday',
    startDate: new Date().toISOString().slice(0, 10),
    completionDate: new Date().toISOString().slice(0, 10),
    weeksToEventOverride: null,
    weeklyAvailabilityDays: [1, 2, 3, 5, 6],
    weeklyAvailabilityMinutes: 360,
    disciplineEmphasis: 'balanced',
    riskTolerance: 'med',
    maxIntensityDaysPerWeek: 2,
    maxDoublesPerWeek: 1,
    longSessionDay: 6,
    coachGuidanceText: '',
  }));

  const effectiveWeekStart = useMemo(
    () => normalizeWeekStart((draftPlanLatest as any)?.setupJson?.weekStart ?? setup.weekStart),
    [draftPlanLatest, setup.weekStart]
  );

  const orderedDays = useMemo(() => orderedDayIndices(effectiveWeekStart), [effectiveWeekStart]);

  const athleteTimeZone = useMemo(() => {
    const tz = (draftPlanLatest as any)?.athlete?.user?.timezone;
    if (typeof tz === 'string' && tz.trim()) return tz.trim();
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }, [draftPlanLatest]);

  // Hydrate setup defaults from latest draft setupJson when available.
  useEffect(() => {
    const setupJson = (draftPlanLatest as any)?.setupJson;
    if (!setupJson || typeof setupJson !== 'object') return;

    const weekStart = normalizeWeekStart((setupJson as any)?.weekStart);
    const completionDate = (setupJson as any)?.completionDate ?? (setupJson as any)?.eventDate;
    const startDate = (setupJson as any)?.startDate;
    const weeksToEventOverrideRaw = (setupJson as any)?.weeksToEventOverride;

    setSetup((prev) => {
      const nextStart = typeof startDate === 'string' && isDayKey(startDate) ? startDate : prev.startDate;
      const nextCompletion =
        typeof completionDate === 'string' && isDayKey(completionDate) ? completionDate : prev.completionDate;

      const nextOverride =
        typeof weeksToEventOverrideRaw === 'number' && Number.isFinite(weeksToEventOverrideRaw)
          ? Math.max(1, Math.min(52, Math.round(weeksToEventOverrideRaw)))
          : null;

      return {
        ...prev,
        weekStart,
        startDate: nextStart,
        completionDate: nextCompletion,
        weeksToEventOverride: nextOverride,
      };
    });
  }, [draftPlanLatest]);

  const derivedWeeksToCompletion = useMemo(() => {
    const w = deriveWeeksToCompletionFromDates({
      startDate: setup.startDate,
      completionDate: setup.completionDate,
      weekStart: setup.weekStart,
    });
    return w;
  }, [setup.completionDate, setup.startDate, setup.weekStart]);

  const effectiveWeeksToCompletion = useMemo(() => {
    return setup.weeksToEventOverride ?? derivedWeeksToCompletion ?? 1;
  }, [derivedWeeksToCompletion, setup.weeksToEventOverride]);

  const planReasoning = useMemo(() => {
    const raw = (draftPlanLatest as any)?.reasoningJson;
    if (!raw || typeof raw !== 'object') return null;
    if ((raw as any)?.version !== 'v1') return null;
    return raw as PlanReasoningV1;
  }, [draftPlanLatest]);

  const fetchBriefLatest = useCallback(async () => {
    const data = await request<{ brief: any | null }>(
      `/api/coach/athletes/${athleteId}/athlete-brief/latest`
    );
    setBriefLatest(data.brief ?? null);
    return data.brief;
  }, [athleteId, request]);

  const fetchDraftPlanLatest = useCallback(async () => {
    const data = await request<{ draftPlan: any | null }>(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/latest`
    );
    setDraftPlanLatest(data.draftPlan);
    return data.draftPlan;
  }, [athleteId, request]);

  const fetchPublishStatus = useCallback(
    async (aiPlanDraftId: string) => {
      const data = await request<{ publishStatus: any }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish-status?aiPlanDraftId=${encodeURIComponent(aiPlanDraftId)}`
      );
      setPublishStatus(data.publishStatus ?? null);
      return data.publishStatus;
    },
    [athleteId, request]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const [brief, draft] = await Promise.all([fetchBriefLatest(), fetchDraftPlanLatest()]);

        if (cancelled) return;

        if (draft?.id) {
          await fetchPublishStatus(String(draft.id));
        } else {
          setPublishStatus(null);
        }

        setBriefLatest(brief ?? null);

      } catch (e) {
        if (cancelled) return;
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to load.';
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [athleteId, fetchBriefLatest, fetchDraftPlanLatest, fetchPublishStatus, request]);

  const refreshBrief = useCallback(async () => {
    setBusy('refresh-brief');
    setError(null);
    try {
      const data = await request<{ brief: any | null }>(
        `/api/coach/athletes/${athleteId}/athlete-brief/refresh`,
        { method: 'POST', data: {} }
      );
      setBriefLatest(data.brief ?? null);
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to refresh.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [athleteId, request]);

  const generatePlanPreview = useCallback(async () => {
    setBusy('generate-plan');
    setError(null);
    try {
      const startDate = isDayKey(setup.startDate) ? setup.startDate : null;
      const completionDate = isDayKey(setup.completionDate) ? setup.completionDate : null;
      if (!startDate) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Starting date is required.');
      }
      if (!completionDate) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Completion date is required.');
      }

      const payload = {
        ...setup,
        startDate,
        eventDate: completionDate,
        completionDate,
        weeklyAvailabilityDays: stableDayList(setup.weeklyAvailabilityDays),
        weeklyAvailabilityMinutes: Number(setup.weeklyAvailabilityMinutes) || 0,
        weeksToEvent: effectiveWeeksToCompletion,
        weeksToEventOverride: setup.weeksToEventOverride ?? undefined,
        maxIntensityDaysPerWeek: Number(setup.maxIntensityDaysPerWeek) || 1,
        maxDoublesPerWeek: Number(setup.maxDoublesPerWeek) || 0,
        longSessionDay: setup.longSessionDay,
        coachGuidanceText: setup.coachGuidanceText || '',
      };

      const created = await request<{ draftPlan: any }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
        { method: 'POST', data: { setup: payload } }
      );

      setDraftPlanLatest(created.draftPlan ?? null);
      if (created.draftPlan?.id) {
        await fetchPublishStatus(String(created.draftPlan.id));
      } else {
        setPublishStatus(null);
      }
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to generate plan.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [athleteId, effectiveWeeksToCompletion, fetchPublishStatus, request, setup]);

  const publishPlan = useCallback(async () => {
    const id = String(draftPlanLatest?.id ?? '');
    if (!id) return;

    setBusy('publish');
    setError(null);
    try {
      const data = await request<{ draftPlan: any; publish: any }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`,
        { method: 'POST', data: { aiPlanDraftId: id } }
      );
      setDraftPlanLatest(data.draftPlan ?? null);
      await fetchPublishStatus(id);
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to publish.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [athleteId, draftPlanLatest?.id, fetchPublishStatus, request]);

  const saveSessionEdit = useCallback(
    async (sessionId: string) => {
      const draftId = String(draftPlanLatest?.id ?? '');
      if (!draftId) return;

      const patch = sessionDraftEdits[sessionId] ?? {};
      const durationMinutes = patch.durationMinutes ? Number.parseInt(patch.durationMinutes, 10) : undefined;
      const notes = patch.notes !== undefined ? patch.notes : undefined;
      const discipline = patch.discipline !== undefined ? patch.discipline : undefined;
      const type = patch.type !== undefined ? patch.type : undefined;
      const objective = patch.objective !== undefined ? patch.objective : undefined;
      const blockEdits = patch.blockSteps
        ? Object.entries(patch.blockSteps)
            .map(([k, v]) => ({ blockIndex: Number.parseInt(k, 10), steps: String(v ?? '') }))
            .filter(
              (x) =>
                Number.isFinite(x.blockIndex) &&
                Number.isInteger(x.blockIndex) &&
                x.blockIndex >= 0 &&
                x.steps.trim().length > 0
            )
        : undefined;

      setBusy(`save-session:${sessionId}`);
      setError(null);
      try {
        const updated = await request<{ draftPlan: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
          {
            method: 'PATCH',
            data: {
              draftPlanId: draftId,
              sessionEdits: [
                {
                  sessionId,
                  ...(Number.isFinite(durationMinutes as any) ? { durationMinutes } : {}),
                  ...(notes !== undefined ? { notes } : {}),
                  ...(discipline !== undefined ? { discipline } : {}),
                  ...(type !== undefined ? { type } : {}),
                  ...(objective !== undefined ? { objective } : {}),
                  ...(blockEdits !== undefined && blockEdits.length ? { blockEdits } : {}),
                },
              ],
            },
          }
        );

        setDraftPlanLatest(updated.draftPlan ?? null);
        setSessionDraftEdits((m) => {
          const next = { ...m };
          delete next[sessionId];
          return next;
        });
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to save.';
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [athleteId, draftPlanLatest?.id, request, sessionDraftEdits]
  );

  const toggleWeekLock = useCallback(
    async (weekIndex: number, locked: boolean) => {
      const draftId = String(draftPlanLatest?.id ?? '');
      if (!draftId) return;

      setBusy(`lock-week:${weekIndex}`);
      setError(null);
      try {
        const updated = await request<{ draftPlan: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
          {
            method: 'PATCH',
            data: {
              draftPlanId: draftId,
              weekLocks: [{ weekIndex, locked }],
            },
          }
        );
        setDraftPlanLatest(updated.draftPlan ?? null);
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to update lock.';
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [athleteId, draftPlanLatest?.id, request]
  );

  const toggleSessionLock = useCallback(
    async (sessionId: string, locked: boolean) => {
      const draftId = String(draftPlanLatest?.id ?? '');
      if (!draftId) return;

      setBusy(`lock-session:${sessionId}`);
      setError(null);
      try {
        const updated = await request<{ draftPlan: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
          {
            method: 'PATCH',
            data: {
              draftPlanId: draftId,
              sessionEdits: [{ sessionId, locked }],
            },
          }
        );
        setDraftPlanLatest(updated.draftPlan ?? null);
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to update lock.';
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [athleteId, draftPlanLatest?.id, request]
  );

  const canStart = !briefLatest;
  const canPlan = Boolean(briefLatest);
  const hasDraft = Boolean(draftPlanLatest?.id);
  const isPublished = publishStatus?.visibilityStatus === 'PUBLISHED';

  const sessionsByWeek = useMemo(() => {
    const sessions = Array.isArray(draftPlanLatest?.sessions) ? draftPlanLatest.sessions : [];
    const byWeek = new Map<number, any[]>();
    for (const s of sessions) {
      const w = Number(s.weekIndex ?? 0);
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w)!.push(s);
    }

    for (const [w, list] of byWeek.entries()) {
      list.sort(
        (a, b) =>
          daySortKey(Number(a.dayOfWeek ?? 0), effectiveWeekStart) - daySortKey(Number(b.dayOfWeek ?? 0), effectiveWeekStart) ||
          Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0)
      );
      byWeek.set(w, list);
    }

    return Array.from(byWeek.entries()).sort(([a], [b]) => a - b);
  }, [draftPlanLatest?.sessions, effectiveWeekStart]);

  const weekLockedByIndex = useMemo(() => {
    const weeks = Array.isArray(draftPlanLatest?.weeks) ? draftPlanLatest.weeks : [];
    const map = new Map<number, boolean>();
    for (const w of weeks) {
      map.set(Number((w as any)?.weekIndex ?? 0), Boolean((w as any)?.locked));
    }
    return map;
  }, [draftPlanLatest?.weeks]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Plan Builder</div>
          <div className="text-sm text-[var(--fg-muted)]">Coach-first planning in four steps.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy != null} onClick={() => window.location.reload()}>
            Refresh
          </Button>
          <a href="/coach/calendar" className="text-sm text-[var(--fg)] underline">
            Scheduling calendar
          </a>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="mt-6 space-y-4">
        <Block title="Athlete Brief">
          {!briefLatest ? (
            <div className="text-sm text-[var(--fg-muted)]">No Athlete Brief yet. Ask the athlete to complete intake.</div>
          ) : (
            <div className="space-y-3 text-sm" data-testid="apb-athlete-brief-details">
              {(() => {
                const sections: Array<{ title: string; items: string[] }> = [];
                const pushLabeled = (items: string[], label: string, value: string | number | null | undefined) => {
                  if (value == null || value === '') return;
                  items.push(`${label}: ${value}`);
                };

                if (briefLatest.version === 'v1.1') {
                  const snapshotItems: string[] = [];
                  pushLabeled(snapshotItems, 'Goal', briefLatest.snapshot?.primaryGoal ?? undefined);
                  pushLabeled(snapshotItems, 'Experience', briefLatest.snapshot?.experienceLabel ?? undefined);
                  if (briefLatest.snapshot?.disciplines?.length) {
                    snapshotItems.push(`Disciplines: ${briefLatest.snapshot.disciplines.map(humanizeDiscipline).join(', ')}`);
                  }
                  if (briefLatest.snapshot?.tags?.length) snapshotItems.push(`Tags: ${briefLatest.snapshot.tags.join(', ')}`);
                  if (snapshotItems.length) sections.push({ title: 'Snapshot', items: snapshotItems });

                  const trainingItems: string[] = [];
                  pushLabeled(trainingItems, 'Weekly minutes', briefLatest.trainingProfile?.weeklyMinutesTarget ?? undefined);
                  if (briefLatest.trainingProfile?.availabilityDays?.length) {
                    trainingItems.push(`Availability: ${briefLatest.trainingProfile.availabilityDays.join(', ')}`);
                  }
                  pushLabeled(trainingItems, 'Schedule', briefLatest.trainingProfile?.scheduleNotes ?? undefined);
                  pushLabeled(trainingItems, 'Timezone', briefLatest.trainingProfile?.timezone ?? undefined);
                  if (trainingItems.length) sections.push({ title: 'Training profile', items: trainingItems });

                  const constraintItems: string[] = [];
                  pushLabeled(constraintItems, 'Injury status', briefLatest.constraintsAndSafety?.injuryStatus ?? undefined);
                  if (briefLatest.constraintsAndSafety?.painHistory?.length) {
                    constraintItems.push(`Pain history: ${briefLatest.constraintsAndSafety.painHistory.join('; ')}`);
                  }
                  pushLabeled(constraintItems, 'Sleep quality', briefLatest.constraintsAndSafety?.sleepQuality ?? undefined);
                  pushLabeled(constraintItems, 'Notes', briefLatest.constraintsAndSafety?.notes ?? undefined);
                  if (constraintItems.length) sections.push({ title: 'Constraints & safety', items: constraintItems });

                  const coachingItems: string[] = [];
                  pushLabeled(coachingItems, 'Tone', briefLatest.coachingPreferences?.tone ?? undefined);
                  pushLabeled(coachingItems, 'Feedback style', briefLatest.coachingPreferences?.feedbackStyle ?? undefined);
                  pushLabeled(coachingItems, 'Check-in cadence', briefLatest.coachingPreferences?.checkinCadence ?? undefined);
                  pushLabeled(coachingItems, 'Structure preference', briefLatest.coachingPreferences?.structurePreference ?? undefined);
                  pushLabeled(coachingItems, 'Motivation style', briefLatest.coachingPreferences?.motivationStyle ?? undefined);
                  if (coachingItems.length) sections.push({ title: 'Coaching preferences', items: coachingItems });

                  const observationItems: string[] = [];
                  pushLabeled(observationItems, 'Coach notes', briefLatest.coachObservations?.notes ?? undefined);
                  if (observationItems.length) sections.push({ title: 'Coach observations', items: observationItems });

                  const guidanceItems: string[] = [];
                  pushLabeled(guidanceItems, 'Plan guidance', briefLatest.planGuidance ?? undefined);
                  if (briefLatest.riskFlags?.length) guidanceItems.push(`Risk flags: ${briefLatest.riskFlags.join(', ')}`);
                  if (guidanceItems.length) sections.push({ title: 'Plan guidance', items: guidanceItems });
                } else {
                  const snapshotItems: string[] = [];
                  if (briefLatest.snapshot?.headline) snapshotItems.push(briefLatest.snapshot.headline);
                  if (briefLatest.snapshot?.tags?.length) snapshotItems.push(`Tags: ${briefLatest.snapshot.tags.join(', ')}`);
                  if (snapshotItems.length) sections.push({ title: 'Snapshot', items: snapshotItems });

                  const goalItems: string[] = [];
                  pushLabeled(goalItems, 'Type', humanizeEnumLabel(briefLatest.goals?.type) ?? briefLatest.goals?.type ?? undefined);
                  pushLabeled(goalItems, 'Details', briefLatest.goals?.details ?? undefined);
                  pushLabeled(goalItems, 'Timeline', humanizeEnumLabel(briefLatest.goals?.timeline) ?? briefLatest.goals?.timeline ?? undefined);
                  pushLabeled(goalItems, 'Focus', humanizeEnumLabel(briefLatest.goals?.focus) ?? briefLatest.goals?.focus ?? undefined);
                  if (goalItems.length) sections.push({ title: 'Goals', items: goalItems });

                  const trainingItems: string[] = [];
                  pushLabeled(
                    trainingItems,
                    'Experience',
                    humanizeEnumLabel(briefLatest.disciplineProfile?.experienceLevel) ?? briefLatest.disciplineProfile?.experienceLevel
                  );
                  const disciplineList = Array.isArray(briefLatest.disciplineProfile?.disciplines)
                    ? briefLatest.disciplineProfile?.disciplines.map(humanizeDiscipline).filter(Boolean)
                    : [];
                  if (disciplineList.length) trainingItems.push(`Disciplines: ${disciplineList.join(', ')}`);
                  pushLabeled(trainingItems, 'Weekly minutes', briefLatest.disciplineProfile?.weeklyMinutes ?? undefined);
                  pushLabeled(
                    trainingItems,
                    'Recent consistency',
                    humanizeEnumLabel(briefLatest.disciplineProfile?.recentConsistency) ??
                      briefLatest.disciplineProfile?.recentConsistency
                  );
                  if (briefLatest.disciplineProfile?.swimConfidence)
                    trainingItems.push(`Swim confidence: ${briefLatest.disciplineProfile.swimConfidence}/5`);
                  if (briefLatest.disciplineProfile?.bikeConfidence)
                    trainingItems.push(`Bike confidence: ${briefLatest.disciplineProfile.bikeConfidence}/5`);
                  if (briefLatest.disciplineProfile?.runConfidence)
                    trainingItems.push(`Run confidence: ${briefLatest.disciplineProfile.runConfidence}/5`);
                  if (trainingItems.length) sections.push({ title: 'Training profile', items: trainingItems });

                  const constraintItems: string[] = [];
                  if (briefLatest.constraints?.availabilityDays?.length) {
                    constraintItems.push(`Available days: ${briefLatest.constraints.availabilityDays.join(', ')}`);
                  }
                  pushLabeled(
                    constraintItems,
                    'Schedule variability',
                    humanizeEnumLabel(briefLatest.constraints?.scheduleVariability) ?? briefLatest.constraints?.scheduleVariability
                  );
                  pushLabeled(
                    constraintItems,
                    'Sleep quality',
                    humanizeEnumLabel(briefLatest.constraints?.sleepQuality) ?? briefLatest.constraints?.sleepQuality
                  );
                  pushLabeled(
                    constraintItems,
                    'Injury status',
                    humanizeEnumLabel(briefLatest.constraints?.injuryStatus) ?? briefLatest.constraints?.injuryStatus
                  );
                  pushLabeled(constraintItems, 'Notes', briefLatest.constraints?.notes ?? undefined);
                  if (constraintItems.length) sections.push({ title: 'Constraints & safety', items: constraintItems });

                  const coachingItems: string[] = [];
                  pushLabeled(
                    coachingItems,
                    'Feedback style',
                    humanizeEnumLabel(briefLatest.coaching?.feedbackStyle) ?? briefLatest.coaching?.feedbackStyle
                  );
                  pushLabeled(
                    coachingItems,
                    'Tone preference',
                    humanizeEnumLabel(briefLatest.coaching?.tonePreference) ?? briefLatest.coaching?.tonePreference
                  );
                  pushLabeled(
                    coachingItems,
                    'Check-in cadence',
                    humanizeEnumLabel(briefLatest.coaching?.checkinPreference) ?? briefLatest.coaching?.checkinPreference
                  );
                  if (briefLatest.coaching?.structurePreference)
                    coachingItems.push(`Structure preference: ${briefLatest.coaching.structurePreference}/5`);
                  pushLabeled(
                    coachingItems,
                    'Motivation style',
                    humanizeEnumLabel(briefLatest.coaching?.motivationStyle) ?? briefLatest.coaching?.motivationStyle
                  );
                  pushLabeled(coachingItems, 'Notes', briefLatest.coaching?.notes ?? undefined);
                  if (coachingItems.length) sections.push({ title: 'Coaching preferences', items: coachingItems });

                  const guidanceItems: string[] = [];
                  pushLabeled(
                    guidanceItems,
                    'Tone',
                    humanizeEnumLabel(briefLatest.planGuidance?.tone) ?? briefLatest.planGuidance?.tone
                  );
                  if (briefLatest.planGuidance?.focusNotes?.length) {
                    guidanceItems.push(`Focus notes: ${briefLatest.planGuidance.focusNotes.join(' ')}`);
                  }
                  if (briefLatest.planGuidance?.coachingCues?.length) {
                    guidanceItems.push(`Coaching cues: ${briefLatest.planGuidance.coachingCues.join(' ')}`);
                  }
                  if (briefLatest.planGuidance?.safetyNotes?.length) {
                    guidanceItems.push(`Safety notes: ${briefLatest.planGuidance.safetyNotes.join(' ')}`);
                  }
                  if (guidanceItems.length) sections.push({ title: 'Plan guidance', items: guidanceItems });

                  if (briefLatest.risks?.length) sections.push({ title: 'Risks', items: briefLatest.risks });
                }

                return sections.map((section) => (
                  <div key={section.title}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">{section.title}</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {section.items.map((item: string, idx: number) => (
                        <li key={`${section.title}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ));
              })()}
            </div>
          )}
        </Block>

        <Block title="1) Athlete Brief">
          <div className="space-y-3">
            <div className="text-sm text-[var(--fg-muted)]">
              Refresh the Athlete Brief using the latest intake + coach profile fields.
            </div>
            <Button
              type="button"
              variant="primary"
              disabled={busy != null}
              data-testid="apb-refresh-brief"
              onClick={refreshBrief}
            >
              {busy === 'refresh-brief' ? 'Refreshing…' : canStart ? 'Build Athlete Brief' : 'Refresh Athlete Brief'}
            </Button>

            {!canPlan ? (
              <div className="text-sm text-[var(--fg-muted)]">Athlete Brief required to continue.</div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3" data-testid="apb-athlete-brief">
                <div className="text-sm font-semibold">Athlete Brief</div>
                <div className="mt-2 text-sm text-[var(--fg-muted)]">Ready for plan generation.</div>
              </div>
            )}
          </div>
        </Block>

        <Block
          title="2) Plan Settings"
          rightAction={
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy != null || !canPlan}
              data-testid="apb-generate-plan"
              onClick={generatePlanPreview}
            >
              {busy === 'generate-plan' ? 'Building…' : 'Build plan preview'}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="mb-1 text-sm font-medium">Coach guidance (optional)</div>
              <Textarea
                rows={3}
                value={setup.coachGuidanceText}
                onChange={(e) => setSetup((s) => ({ ...s, coachGuidanceText: e.target.value }))}
                placeholder="E.g. avoid intensity on Fridays; keep long run on Sunday"
                data-testid="apb-coach-guidance"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Starting date</div>
              <Input
                type="date"
                value={setup.startDate}
                onChange={(e) =>
                  setSetup((s) => ({
                    ...s,
                    startDate: e.target.value,
                  }))
                }
                data-testid="apb-start-date"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Completion date</div>
              <Input
                type="date"
                value={setup.completionDate}
                onChange={(e) =>
                  setSetup((s) => ({
                    ...s,
                    completionDate: e.target.value,
                  }))
                }
                data-testid="apb-completion-date"
              />
            </div>

            <div className="md:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Weeks to completion</div>
                <Button
                  type="button"
                  size="sm"
                  variant={setup.weeksToEventOverride == null ? 'primary' : 'secondary'}
                  onClick={() =>
                    setSetup((s) => ({
                      ...s,
                      weeksToEventOverride: s.weeksToEventOverride == null ? (derivedWeeksToCompletion ?? 1) : null,
                    }))
                  }
                  data-testid="apb-weeks-auto-toggle"
                >
                  {setup.weeksToEventOverride == null ? 'Auto' : 'Manual'}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input
                  type="number"
                  min={1}
                  max={52}
                  disabled={busy != null || setup.weeksToEventOverride == null}
                  value={String(effectiveWeeksToCompletion)}
                  onChange={(e) =>
                    setSetup((s) => ({
                      ...s,
                      weeksToEventOverride: Math.max(1, Math.min(52, Number(e.target.value) || 1)),
                    }))
                  }
                  data-testid="apb-weeks-to-completion"
                />

                <div className="text-xs text-[var(--fg-muted)]">
                  Derived from dates: {derivedWeeksToCompletion ?? '—'} week{(derivedWeeksToCompletion ?? 0) === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Week starts on</div>
              <Select
                value={setup.weekStart}
                onChange={(e) => setSetup((s) => ({ ...s, weekStart: e.target.value as any }))}
                data-testid="apb-week-start"
              >
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Weekly time budget (minutes)</div>
              <Input
                type="number"
                min={0}
                max={10_000}
                value={String(setup.weeklyAvailabilityMinutes)}
                onChange={(e) => setSetup((s) => ({ ...s, weeklyAvailabilityMinutes: Number(e.target.value) }))}
                data-testid="apb-weekly-minutes"
              />
            </div>

            <div className="md:col-span-2" data-testid="apb-available-days">
              <div className="mb-1 text-sm font-medium">Available days</div>
              <div className="flex flex-wrap gap-2">
                {orderedDays.map((dayIndex) => {
                  const label = DAY_NAMES_SUN0[dayIndex]?.slice(0, 3) ?? String(dayIndex);
                  const selected = setup.weeklyAvailabilityDays.includes(dayIndex);
                  return (
                    <Button
                      key={dayIndex}
                      type="button"
                      size="sm"
                      variant={selected ? 'primary' : 'secondary'}
                      onClick={() =>
                        setSetup((s) => {
                          const next = selected
                            ? s.weeklyAvailabilityDays.filter((d) => d !== dayIndex)
                            : [...s.weeklyAvailabilityDays, dayIndex];
                          return { ...s, weeklyAvailabilityDays: stableDayList(next) };
                        })
                      }
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Discipline emphasis</div>
              <Select
                value={setup.disciplineEmphasis}
                onChange={(e) => setSetup((s) => ({ ...s, disciplineEmphasis: e.target.value as any }))}
                data-testid="apb-discipline"
              >
                <option value="balanced">Balanced</option>
                <option value="swim">Swim</option>
                <option value="bike">Bike</option>
                <option value="run">Run</option>
              </Select>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Risk tolerance</div>
              <Select
                value={setup.riskTolerance}
                onChange={(e) => setSetup((s) => ({ ...s, riskTolerance: e.target.value as any }))}
                data-testid="apb-risk"
              >
                <option value="low">Conservative</option>
                <option value="med">Balanced</option>
                <option value="high">Aggressive</option>
              </Select>
            </div>
          </div>
        </Block>

        <Block title="3) Review Plan">
          {!hasDraft ? (
            <div className="text-sm text-[var(--fg-muted)]">Generate a plan preview to see sessions.</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3" data-testid="apb-plan-reasoning">
                <div className="text-sm font-semibold">Plan Reasoning</div>
                {!planReasoning ? (
                  <p className="mt-2 text-xs text-[var(--fg-muted)]">Plan reasoning will appear once the draft is generated.</p>
                ) : (
                  <div className="mt-3 space-y-3 text-sm">
                    {planReasoning.sources?.length ? (
                      <div>
                        <div className="text-xs font-medium text-[var(--fg-muted)]">Based on Plan Library sources</div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          {planReasoning.sources.map((source) => (
                            <li key={source.planSourceVersionId}>
                              <span className="font-medium">{source.title}</span> · {source.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {planReasoning.planSourceInfluence ? (
                      <div data-testid="apb-plan-source-influence">
                        <div className="text-xs font-medium text-[var(--fg-muted)]">Plan source influence</div>
                        <div className="mt-1 text-xs text-[var(--fg-muted)]">
                          Confidence:{' '}
                          <span className="uppercase text-[var(--text)]">
                            {planReasoning.planSourceInfluence.confidence}
                          </span>
                          {planReasoning.planSourceInfluence.archetype ? (
                            <> · Archetype: <span className="text-[var(--text)]">{planReasoning.planSourceInfluence.archetype}</span></>
                          ) : null}
                        </div>
                        {planReasoning.planSourceInfluence.notes?.length ? (
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                            {planReasoning.planSourceInfluence.notes.map((note, idx) => (
                              <li key={`psi-${idx}`}>{note}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium text-[var(--fg-muted)]">Priorities</div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          {planReasoning.priorities.map((p) => (
                            <li key={p.key}>{p.label}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-[var(--fg-muted)]">Constraints</div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          {planReasoning.constraints.map((c) => (
                            <li key={c.key}>{c.label}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium text-[var(--fg-muted)]">Risks</div>
                        {planReasoning.risks.length ? (
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {planReasoning.risks.map((r) => (
                              <li key={r.key}>
                                {r.label}{' '}
                                <span className="text-[10px] uppercase text-[var(--fg-muted)]">({r.severity})</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1 text-xs text-[var(--fg-muted)]">No material risks flagged.</div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-medium text-[var(--fg-muted)]">Targets</div>
                        <ul className="mt-1 space-y-1 text-xs text-[var(--fg-muted)]">
                          <li>Weekly minutes target: <span className="text-[var(--text)]">{planReasoning.targets.weeklyMinutesTarget}</span></li>
                          <li>Max intensity days/week: <span className="text-[var(--text)]">{planReasoning.targets.maxIntensityDaysPerWeek}</span></li>
                          <li>Max doubles/week: <span className="text-[var(--text)]">{planReasoning.targets.maxDoublesPerWeek}</span></li>
                          <li>Long session day: <span className="text-[var(--text)]">{planReasoning.targets.longSessionDay == null ? '—' : DAY_NAMES_SUN0[planReasoning.targets.longSessionDay] ?? planReasoning.targets.longSessionDay}</span></li>
                        </ul>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-[var(--fg-muted)]">Explanations</div>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {planReasoning.explanations.map((explanation, idx) => (
                          <li key={`ex-${idx}`}>{explanation}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-[var(--fg-muted)]">Weekly intent</div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {planReasoning.weeks.map((week) => {
                          const splitEntries = Object.entries(week.disciplineSplitMinutes)
                            .filter(([, v]) => typeof v === 'number' && v > 0)
                            .map(([k, v]) => `${k}: ${v}m`)
                            .join(', ');
                          return (
                            <div key={week.weekIndex} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2">
                              <div className="text-xs font-medium">Week {week.weekIndex + 1}: {week.weekIntent}</div>
                              <div className="mt-1 text-xs text-[var(--fg-muted)]">
                                {week.volumeMinutesPlanned}m ({week.volumeDeltaPct >= 0 ? '+' : ''}{week.volumeDeltaPct}%) · {week.intensityDaysPlanned} intensity day(s)
                              </div>
                              <div className="mt-1 text-xs text-[var(--fg-muted)]">
                                Split: {splitEntries || '—'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {sessionsByWeek.map(([weekIndex, sessions]) => (
                <div key={weekIndex} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3" data-testid="apb-week">
                  {(() => {
                    const wIdx = Number(weekIndex);
                    const startDate = setup.startDate;
                    const completionDate = setup.completionDate;
                    const weekStart = effectiveWeekStart;

                    const weekCommencingDayKey = (() => {
                      if (isDayKey(startDate)) {
                        const week0 = startOfWeekDayKeyWithWeekStart(startDate, weekStart);
                        return addDaysToDayKey(week0, 7 * wIdx);
                      }

                      if (isDayKey(completionDate)) {
                        const completionWeekStart = startOfWeekDayKeyWithWeekStart(completionDate, weekStart);
                        const remainingWeeks = Math.max(1, effectiveWeeksToCompletion) - 1 - wIdx;
                        return addDaysToDayKey(completionWeekStart, -7 * remainingWeeks);
                      }

                      return '';
                    })();

                    return (
                      <div className="mb-3 flex items-center justify-between" data-testid="apb-week-header">
                        <div className="text-sm font-semibold" data-testid="apb-week-heading">
                          Week {wIdx + 1}{' '}
                          {weekCommencingDayKey ? (
                            <span className="font-normal text-[var(--fg-muted)]" data-testid="apb-week-commencing">
                              • Commencing {formatDayKeyShort(weekCommencingDayKey)}
                            </span>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={(weekLockedByIndex.get(Number(weekIndex)) ?? false) ? 'primary' : 'secondary'}
                          disabled={busy != null}
                          data-testid="apb-week-lock-toggle"
                          onClick={() =>
                            toggleWeekLock(
                              Number(weekIndex),
                              !(weekLockedByIndex.get(Number(weekIndex)) ?? false)
                            )
                          }
                        >
                          {busy === `lock-week:${Number(weekIndex)}`
                            ? 'Updating…'
                            : (weekLockedByIndex.get(Number(weekIndex)) ?? false)
                              ? 'Unlock week'
                              : 'Lock week'}
                        </Button>
                      </div>
                    );
                  })()}

                  <div className="space-y-3">
                    {sessions.map((s) => {
                      const detailParsed = sessionDetailV1Schema.safeParse((s as any)?.detailJson ?? null);
                      const objective = detailParsed.success ? detailParsed.data.objective : null;
                      const blocks = detailParsed.success ? detailParsed.data.structure : [];
                      const workoutDetailPreview = detailParsed.success
                        ? renderWorkoutDetailFromSessionDetailV1(detailParsed.data)
                        : null;

                      const sessionId = String(s.id);
                      const edit = sessionDraftEdits[sessionId] ?? {};

                      const weekLocked = weekLockedByIndex.get(Number(weekIndex)) ?? false;
                      const sessionLocked = Boolean((s as any)?.locked);
                      const locked = weekLocked || sessionLocked;

                      const disciplineOptions = ['RUN', 'BIKE', 'SWIM', 'STRENGTH', 'OTHER'];
                      const currentDisciplineRaw = String(edit.discipline ?? (s as any)?.discipline ?? '').trim().toUpperCase();
                      const selectedDiscipline = currentDisciplineRaw || disciplineOptions[0];
                      const disciplineChoices = Array.from(new Set([selectedDiscipline, ...disciplineOptions]));

                      return (
                        <div
                          key={sessionId}
                          className={`rounded-md border border-[var(--border-subtle)] bg-[var(--bg)] px-3 py-3 ${locked ? 'opacity-80' : ''}`}
                          data-testid="apb-session"
                        >
                          {(() => {
                            const wIdx = Number(weekIndex);
                            const startDate = setup.startDate;
                            const completionDate = setup.completionDate;
                            const weekStart = effectiveWeekStart;

                            const weekCommencingDayKey = (() => {
                              if (isDayKey(startDate)) {
                                const week0 = startOfWeekDayKeyWithWeekStart(startDate, weekStart);
                                return addDaysToDayKey(week0, 7 * wIdx);
                              }

                              if (isDayKey(completionDate)) {
                                const completionWeekStart = startOfWeekDayKeyWithWeekStart(completionDate, weekStart);
                                const remainingWeeks = Math.max(1, effectiveWeeksToCompletion) - 1 - wIdx;
                                return addDaysToDayKey(completionWeekStart, -7 * remainingWeeks);
                              }

                              return '';
                            })();

                            const sessionDayKey = weekCommencingDayKey
                              ? addDaysToDayKey(weekCommencingDayKey, dayOffsetFromWeekStart(Number(s.dayOfWeek) ?? 0, weekStart))
                              : '';

                            return (
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-medium" data-testid="apb-session-day">
                                  {sessionDayKey ? formatDayKeyShort(sessionDayKey) : DAY_NAMES_SUN0[Number(s.dayOfWeek) ?? 0]}
                                  {locked ? (
                                    <span className="ml-2 rounded bg-[var(--bg-structure)] px-2 py-0.5 text-xs text-[var(--fg-muted)]">Locked</span>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })()}

                          {weekLocked ? (
                            <div className="mt-2 text-xs text-[var(--fg-muted)]">Week is locked — unlock the week to edit sessions.</div>
                          ) : sessionLocked ? (
                            <div className="mt-2 text-xs text-[var(--fg-muted)]">Session is locked — unlock the session to edit details.</div>
                          ) : null}

                          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Discipline</div>
                              <Select
                                value={selectedDiscipline}
                                disabled={busy != null || locked}
                                data-testid="apb-session-discipline"
                                onChange={(e) =>
                                  setSessionDraftEdits((m) => ({
                                    ...m,
                                    [sessionId]: { ...(m[sessionId] ?? {}), discipline: e.target.value },
                                  }))
                                }
                              >
                                {disciplineChoices.map((d) => (
                                  <option key={d} value={d}>
                                    {d}
                                  </option>
                                ))}
                              </Select>
                            </div>

                            <div>
                              <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Session Title</div>
                              <Input
                                value={edit.type ?? String((s as any)?.type ?? '')}
                                disabled={busy != null || locked}
                                data-testid="apb-session-title"
                                onChange={(e) =>
                                  setSessionDraftEdits((m) => ({
                                    ...m,
                                    [sessionId]: { ...(m[sessionId] ?? {}), type: e.target.value },
                                  }))
                                }
                                placeholder="e.g. Endurance"
                              />
                            </div>
                          </div>

                          {workoutDetailPreview ? (
                            <div className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
                              <div className="text-xs font-medium text-[var(--fg-muted)]">Workout instructions (preview)</div>
                              <div className="mt-1 whitespace-pre-wrap text-sm" data-testid="apb-session-workout-detail-preview">
                                {workoutDetailPreview}
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-3">
                            <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Objective</div>
                            <Input
                              value={edit.objective ?? (objective ?? '')}
                              disabled={busy != null || locked}
                              data-testid="apb-session-objective-input"
                              onChange={(e) =>
                                setSessionDraftEdits((m) => ({
                                  ...m,
                                  [sessionId]: { ...(m[sessionId] ?? {}), objective: e.target.value },
                                }))
                              }
                              placeholder="Short session objective"
                            />
                          </div>

                          <div className="mt-3">
                            <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Duration</div>
                            <Input
                              value={edit.durationMinutes ?? String(s.durationMinutes ?? '')}
                              disabled={busy != null || locked}
                              onChange={(e) =>
                                setSessionDraftEdits((m) => ({
                                  ...m,
                                  [sessionId]: { ...(m[sessionId] ?? {}), durationMinutes: e.target.value },
                                }))
                              }
                              data-testid="apb-session-duration"
                            />
                            <div className="mt-1 text-xs text-[var(--fg-muted)]">Durations are adjusted to 5-minute blocks</div>
                          </div>

                          {blocks.length ? (
                            <div className="mt-3 space-y-2" data-testid="apb-session-block-editor">
                              <div className="text-xs font-medium text-[var(--fg-muted)]">Block steps (editable)</div>
                              {blocks.map((b, idx) => (
                                <div
                                  key={idx}
                                  className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-2 py-2"
                                >
                                  <div className="mb-1 text-xs font-medium">
                                    {String(b.blockType).toUpperCase()}
                                    {b.durationMinutes ? ` · ${b.durationMinutes} min` : ''}
                                  </div>
                                  <Textarea
                                    rows={2}
                                    value={edit.blockSteps?.[idx] ?? String(b.steps ?? '')}
                                    disabled={busy != null || locked}
                                    data-testid={`apb-session-block-steps-${idx}`}
                                    onChange={(e) =>
                                      setSessionDraftEdits((m) => ({
                                        ...m,
                                        [sessionId]: {
                                          ...(m[sessionId] ?? {}),
                                          blockSteps: {
                                            ...((m[sessionId] ?? {}).blockSteps ?? {}),
                                            [idx]: e.target.value,
                                          },
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-3">
                            <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Coach Notes</div>
                            <Textarea
                              rows={3}
                              value={edit.notes ?? String(s.notes ?? '')}
                              disabled={busy != null || locked}
                              onChange={(e) =>
                                setSessionDraftEdits((m) => ({
                                  ...m,
                                  [sessionId]: { ...(m[sessionId] ?? {}), notes: e.target.value },
                                }))
                              }
                              data-testid="apb-session-notes"
                            />
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busy != null || locked}
                              data-testid="apb-session-save"
                              onClick={() => saveSessionEdit(sessionId)}
                            >
                              {busy === `save-session:${sessionId}` ? 'Saving…' : 'Save'}
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant={sessionLocked ? 'primary' : 'secondary'}
                              disabled={busy != null || weekLocked}
                              data-testid="apb-session-lock-toggle"
                              onClick={() => toggleSessionLock(sessionId, !sessionLocked)}
                            >
                              {busy === `lock-session:${sessionId}`
                                ? 'Updating…'
                                : sessionLocked
                                  ? 'Unlock session'
                                  : 'Lock session'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block
          title="4) Publish"
          rightAction={
            <Button
              type="button"
              size="sm"
              disabled={busy != null || !hasDraft}
              data-testid="apb-publish"
              onClick={publishPlan}
            >
              {busy === 'publish' ? 'Publishing…' : 'Publish plan to athlete calendar'}
            </Button>
          }
        >
          {!hasDraft ? (
            <div className="text-sm text-[var(--fg-muted)]">Build a plan preview before publishing.</div>
          ) : isPublished ? (
            <div className="space-y-2">
              <div
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3 text-sm"
                data-testid="apb-publish-success"
              >
                Published — sessions are now visible in the scheduling calendar.
              </div>
              <a href="/coach/calendar" className="text-sm text-[var(--fg)] underline" data-testid="apb-open-calendar">
                Open scheduling calendar
              </a>
            </div>
          ) : (
            <div className="text-sm text-[var(--fg-muted)]">Publishing will schedule all plan weeks onto the athlete’s calendar.</div>
          )}
        </Block>
      </div>
    </div>
  );
}
