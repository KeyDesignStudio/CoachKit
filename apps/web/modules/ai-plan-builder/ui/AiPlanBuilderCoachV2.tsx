/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError, useApi } from '@/components/api-client';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { isDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';
import { renderWorkoutDetailFromSessionDetailV1 } from '@/lib/workoutDetailRenderer';

import { DAY_NAMES_SUN0, daySortKey, normalizeWeekStart } from '../lib/week-start';
import { sessionDetailV1Schema } from '../rules/session-detail';

type AthleteProfileSummary = {
  primaryGoal?: string | null;
  focus?: string | null;
  eventName?: string | null;
  eventDate?: string | null;
  weeklyMinutesTarget?: number | null;
  availableDays?: string[] | null;
  disciplines?: string[] | null;
  experienceLevel?: string | null;
  injuryStatus?: string | null;
  constraintsNotes?: string | null;
};

type TrainingRequestForm = {
  goalDetails: string;
  goalFocus: string;
  eventName: string;
  eventDate: string;
  goalTimeline: string;
  weeklyMinutes: string;
  availabilityDays: string[];
  experienceLevel: string;
  injuryStatus: string;
  constraintsNotes: string;
};

type SetupState = {
  weekStart: 'monday' | 'sunday';
  startDate: string;
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
  programPolicy: '' | 'COUCH_TO_5K' | 'COUCH_TO_IRONMAN_26' | 'HALF_TO_FULL_MARATHON';
};

type IntakeLifecycle = {
  latestSubmittedIntake: any | null;
  openDraftIntake: any | null;
  lifecycle?: { hasOpenRequest: boolean; canOpenNewRequest: boolean } | null;
};

const DAY_NAME_TO_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};
const DAY_NAME_TO_SHORT: Record<string, string> = {
  Sunday: 'Sun',
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
};
const DAY_SHORTS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const GOAL_TIMELINE_OPTIONS = ['No date in mind', 'In 6-8 weeks', 'In 2-3 months', 'In 3-6 months', 'In 6-12 months'];

function formatApiErrorMessage(e: ApiClientError): string {
  if (e.status === 429 && e.code === 'LLM_RATE_LIMITED') {
    return 'AI is temporarily rate-limited. Please retry.';
  }
  if (e.code === 'CONFIG_MISSING') {
    return 'AI configuration is unavailable right now.';
  }
  return e.message || 'Something went wrong.';
}

function dayShortsFromProfileDays(days: string[] | null | undefined): string[] {
  if (!Array.isArray(days)) return [];
  const normalized = days
    .map((d) => {
      const trimmed = String(d ?? '').trim();
      if (!trimmed) return null;
      return DAY_NAME_TO_SHORT[trimmed] ?? (DAY_SHORTS.includes(trimmed as any) ? trimmed : null);
    })
    .filter((d): d is string => Boolean(d));
  return Array.from(new Set(normalized));
}

function buildTrainingRequestFromProfile(profile: AthleteProfileSummary | null): TrainingRequestForm {
  return {
    goalDetails: String(profile?.primaryGoal ?? ''),
    goalFocus: String(profile?.focus ?? ''),
    eventName: String(profile?.eventName ?? ''),
    eventDate: typeof profile?.eventDate === 'string' ? profile.eventDate.slice(0, 10) : '',
    goalTimeline: '',
    weeklyMinutes: profile?.weeklyMinutesTarget != null ? String(profile.weeklyMinutesTarget) : '',
    availabilityDays: dayShortsFromProfileDays(profile?.availableDays ?? null),
    experienceLevel: String(profile?.experienceLevel ?? ''),
    injuryStatus: String(profile?.injuryStatus ?? ''),
    constraintsNotes: String(profile?.constraintsNotes ?? ''),
  };
}

function buildTrainingRequestFromDraftJson(raw: unknown): TrainingRequestForm {
  const map = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const availability = Array.isArray(map.availability_days) ? map.availability_days : [];
  const availabilityDays = availability
    .map((d) => String(d ?? '').trim())
    .filter((d) => DAY_SHORTS.includes(d as any) || Object.keys(DAY_NAME_TO_SHORT).includes(d))
    .map((d) => (DAY_SHORTS.includes(d as any) ? d : DAY_NAME_TO_SHORT[d]));

  const normalizeDayKeyLike = (value: unknown): string => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (isDayKey(text)) return text;
    const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return '';
    const [, dd, mm, yyyy] = m;
    const candidate = `${yyyy}-${mm}-${dd}`;
    return isDayKey(candidate) ? candidate : '';
  };

  return {
    goalDetails: String(map.goal_details ?? ''),
    goalFocus: String(map.goal_focus ?? ''),
    eventName: String(map.event_name ?? ''),
    eventDate: normalizeDayKeyLike(map.event_date),
    goalTimeline: String(map.goal_timeline ?? ''),
    weeklyMinutes: map.weekly_minutes != null ? String(map.weekly_minutes) : '',
    availabilityDays: Array.from(new Set(availabilityDays)),
    experienceLevel: String(map.experience_level ?? ''),
    injuryStatus: String(map.injury_status ?? ''),
    constraintsNotes: String(map.constraints_notes ?? ''),
  };
}

function buildDraftJsonFromTrainingRequest(form: TrainingRequestForm): Record<string, unknown> {
  return {
    goal_details: form.goalDetails.trim() || null,
    goal_focus: form.goalFocus.trim() || null,
    event_name: form.eventName.trim() || null,
    event_date: form.eventDate || null,
    goal_timeline: form.goalTimeline || null,
    weekly_minutes: form.weeklyMinutes ? Number(form.weeklyMinutes) : null,
    availability_days: form.availabilityDays,
    experience_level: form.experienceLevel.trim() || null,
    injury_status: form.injuryStatus.trim() || null,
    constraints_notes: form.constraintsNotes.trim() || null,
  };
}

function goalTimelineToWeeks(raw: string): number | null {
  const value = String(raw ?? '').trim();
  if (!value || value === 'No date in mind') return null;
  if (value === 'In 6-8 weeks') return 8;
  if (value === 'In 2-3 months') return 12;
  if (value === 'In 3-6 months') return 24;
  if (value === 'In 6-12 months') return 48;
  return null;
}

function subtractWeeksFromDayKey(dayKey: string, weeks: number): string {
  if (!isDayKey(dayKey) || !Number.isFinite(weeks) || weeks <= 1) return dayKey;
  const date = parseDayKeyToUtcDate(dayKey);
  date.setUTCDate(date.getUTCDate() - (weeks - 1) * 7);
  return date.toISOString().slice(0, 10);
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function dayIndicesFromShorts(days: string[]): number[] {
  return Array.from(
    new Set(
      (Array.isArray(days) ? days : [])
        .map((d) => {
          const idx = DAY_SHORTS.indexOf(String(d ?? '').trim() as any);
          return idx >= 0 ? idx : null;
        })
        .filter((d): d is number => d != null)
    )
  ).sort((a, b) => a - b);
}

function normalizeDayIndices(days: string[] | null | undefined): number[] {
  if (!Array.isArray(days)) return [];
  return days
    .map((d) => DAY_NAME_TO_INDEX[String(d).trim()] ?? null)
    .filter((d): d is number => typeof d === 'number')
    .filter((d, idx, arr) => arr.indexOf(d) === idx)
    .sort((a, b) => a - b);
}

function stableDayList(days: number[]): number[] {
  return Array.from(new Set(days)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
}

function deriveDisciplineEmphasis(disciplines: string[] | null | undefined): SetupState['disciplineEmphasis'] {
  const set = new Set((disciplines ?? []).map((d) => String(d).toUpperCase()));
  const hasRun = set.has('RUN');
  const hasBike = set.has('BIKE');
  const hasSwim = set.has('SWIM');
  if ((hasRun && hasBike) || (hasRun && hasSwim) || (hasBike && hasSwim)) return 'balanced';
  if (hasRun) return 'run';
  if (hasBike) return 'bike';
  if (hasSwim) return 'swim';
  return 'balanced';
}

function defaultLongSessionDay(availableDays: number[]): number | null {
  if (!availableDays.length) return null;
  if (availableDays.includes(6)) return 6;
  if (availableDays.includes(0)) return 0;
  return availableDays[availableDays.length - 1] ?? null;
}

function buildSetupFromProfile(profile: AthleteProfileSummary | null): SetupState {
  const today = new Date().toISOString().slice(0, 10);
  const availableDays = normalizeDayIndices(profile?.availableDays ?? null);
  const weeklyMinutesTarget = typeof profile?.weeklyMinutesTarget === 'number' ? profile.weeklyMinutesTarget : 0;

  return {
    weekStart: 'monday',
    startDate: today,
    completionDate: today,
    weeksToEventOverride: null,
    weeklyAvailabilityDays: availableDays,
    weeklyAvailabilityMinutes: weeklyMinutesTarget,
    disciplineEmphasis: deriveDisciplineEmphasis(profile?.disciplines ?? null),
    riskTolerance: 'med',
    maxIntensityDaysPerWeek: 1,
    maxDoublesPerWeek: 0,
    longSessionDay: defaultLongSessionDay(availableDays),
    coachGuidanceText: '',
    programPolicy: '',
  };
}

function deriveWeeksToCompletionFromDates(params: {
  startDate: string;
  completionDate: string;
  weekStart: 'monday' | 'sunday';
}): number | null {
  if (!isDayKey(params.startDate) || !isDayKey(params.completionDate)) return null;

  const start = parseDayKeyToUtcDate(params.startDate);
  const end = parseDayKeyToUtcDate(params.completionDate);
  const startJsDay = params.weekStart === 'sunday' ? 0 : 1;

  const startDiff = (start.getUTCDay() - startJsDay + 7) % 7;
  start.setUTCDate(start.getUTCDate() - startDiff);

  const endDiff = (end.getUTCDay() - startJsDay + 7) % 7;
  end.setUTCDate(end.getUTCDate() - endDiff);

  const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const weeks = Math.floor(diffDays / 7) + 1;
  return Math.max(1, Math.min(52, weeks));
}

function getWeekCommencingLabel(weekSessions: any[]): string {
  const first = weekSessions.find((s) => isDayKey(String(s?.dayKey ?? '')))?.dayKey;
  if (!first || !isDayKey(String(first))) return 'Week';
  const d = parseDayKeyToUtcDate(String(first));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(-2)}`;
}

export function AiPlanBuilderCoachV2({ athleteId }: { athleteId: string }) {
  const { request } = useApi();
  const hasAutoSyncedRequestRef = useRef(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [athleteProfile, setAthleteProfile] = useState<AthleteProfileSummary | null>(null);
  const [intakeLifecycle, setIntakeLifecycle] = useState<IntakeLifecycle | null>(null);
  const [draftPlanLatest, setDraftPlanLatest] = useState<any | null>(null);
  const [publishStatus, setPublishStatus] = useState<any | null>(null);

  const [trainingRequest, setTrainingRequest] = useState<TrainingRequestForm>(() => buildTrainingRequestFromProfile(null));
  const [setup, setSetup] = useState<SetupState>(() => buildSetupFromProfile(null));

  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number>(0);
  const [sessionDetailsById, setSessionDetailsById] = useState<
    Record<string, { detailJson: any | null; loading: boolean; error?: string | null }>
  >({});

  const effectiveWeekStart = useMemo(
    () => normalizeWeekStart((draftPlanLatest as any)?.setupJson?.weekStart ?? setup.weekStart),
    [draftPlanLatest, setup.weekStart]
  );

  const effectiveWeeksToCompletion = useMemo(() => {
    if (setup.weeksToEventOverride && setup.weeksToEventOverride >= 1) return setup.weeksToEventOverride;
    return (
      deriveWeeksToCompletionFromDates({
        startDate: setup.startDate,
        completionDate: setup.completionDate,
        weekStart: setup.weekStart,
      }) ?? 12
    );
  }, [setup.completionDate, setup.startDate, setup.weekStart, setup.weeksToEventOverride]);

  const requestDefaults = useMemo(() => {
    const completionDate = isDayKey(trainingRequest.eventDate) ? trainingRequest.eventDate : null;
    const weeksToEventOverride = goalTimelineToWeeks(trainingRequest.goalTimeline);
    const startDate = completionDate && weeksToEventOverride ? subtractWeeksFromDayKey(completionDate, weeksToEventOverride) : null;
    const weeklyAvailabilityMinutes = Number(trainingRequest.weeklyMinutes);
    const weeklyAvailabilityDays = dayIndicesFromShorts(trainingRequest.availabilityDays);
    const coachGuidanceText = [
      trainingRequest.goalDetails.trim(),
      trainingRequest.goalFocus.trim() ? `Focus: ${trainingRequest.goalFocus.trim()}` : '',
      trainingRequest.constraintsNotes.trim() ? `Constraints: ${trainingRequest.constraintsNotes.trim()}` : '',
      trainingRequest.injuryStatus.trim() ? `Injury/Pain: ${trainingRequest.injuryStatus.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      startDate,
      completionDate,
      weeksToEventOverride,
      weeklyAvailabilityMinutes: Number.isFinite(weeklyAvailabilityMinutes) && weeklyAvailabilityMinutes > 0 ? weeklyAvailabilityMinutes : null,
      weeklyAvailabilityDays,
      coachGuidanceText: coachGuidanceText || null,
    };
  }, [trainingRequest]);

  const sessionsByWeek = useMemo(() => {
    const sessions = Array.isArray(draftPlanLatest?.sessions) ? draftPlanLatest.sessions : [];
    const byWeek = new Map<number, any[]>();
    for (const s of sessions) {
      const week = Number(s?.weekIndex ?? 0);
      if (!byWeek.has(week)) byWeek.set(week, []);
      byWeek.get(week)!.push(s);
    }

    for (const [weekIndex, rows] of byWeek.entries()) {
      rows.sort(
        (a, b) =>
          daySortKey(Number(a.dayOfWeek ?? 0), effectiveWeekStart) - daySortKey(Number(b.dayOfWeek ?? 0), effectiveWeekStart) ||
          Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0)
      );
      byWeek.set(weekIndex, rows);
    }

    return Array.from(byWeek.entries()).sort(([a], [b]) => a - b);
  }, [draftPlanLatest, effectiveWeekStart]);

  const selectedWeekSessions = useMemo(() => {
    return sessionsByWeek.find(([weekIndex]) => weekIndex === selectedWeekIndex)?.[1] ?? [];
  }, [selectedWeekIndex, sessionsByWeek]);
  const weekOptions = useMemo(
    () =>
      sessionsByWeek.map(([weekIndex, weekSessions]) => ({
        weekIndex,
        label: `Week ${weekIndex + 1} (${getWeekCommencingLabel(weekSessions)})`,
      })),
    [sessionsByWeek]
  );

  const fetchAthleteProfile = useCallback(async () => {
    const data = await request<{ athlete: AthleteProfileSummary }>(`/api/coach/athletes/${athleteId}`);
    setAthleteProfile(data.athlete ?? null);
    return data.athlete ?? null;
  }, [athleteId, request]);

  const fetchIntakeLifecycle = useCallback(async () => {
    const data = await request<any>(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/latest`);
    const next: IntakeLifecycle = {
      latestSubmittedIntake: data.latestSubmittedIntake ?? data.intakeResponse ?? null,
      openDraftIntake: data.openDraftIntake ?? null,
      lifecycle: data.lifecycle ?? null,
    };
    setIntakeLifecycle(next);
    return next;
  }, [athleteId, request]);

  const fetchDraftPlanLatest = useCallback(async () => {
    const data = await request<{ draftPlan: any | null }>(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/latest`
    );
    setDraftPlanLatest(data.draftPlan ?? null);
    return data.draftPlan ?? null;
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
      setError(null);
      try {
        const [profile, intake, draft] = await Promise.all([
          fetchAthleteProfile(),
          fetchIntakeLifecycle(),
          fetchDraftPlanLatest(),
        ]);

        if (cancelled) return;

        if (intake?.openDraftIntake?.draftJson) {
          setTrainingRequest(buildTrainingRequestFromDraftJson(intake.openDraftIntake.draftJson));
        } else if (intake?.latestSubmittedIntake?.draftJson) {
          setTrainingRequest(buildTrainingRequestFromDraftJson(intake.latestSubmittedIntake.draftJson));
        } else {
          setTrainingRequest(buildTrainingRequestFromProfile(profile));
        }

        setSetup((prev) => {
          const seeded = buildSetupFromProfile(profile);
          return {
            ...seeded,
            startDate: prev.startDate,
            completionDate: prev.completionDate,
          };
        });

        if (draft?.id) {
          await fetchPublishStatus(String(draft.id));
        } else {
          setPublishStatus(null);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to load builder.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchAthleteProfile, fetchDraftPlanLatest, fetchIntakeLifecycle, fetchPublishStatus]);

  useEffect(() => {
    if (!sessionsByWeek.length) {
      setSelectedWeekIndex(0);
      return;
    }
    const exists = sessionsByWeek.some(([weekIndex]) => weekIndex === selectedWeekIndex);
    if (!exists) setSelectedWeekIndex(sessionsByWeek[0]?.[0] ?? 0);
  }, [selectedWeekIndex, sessionsByWeek]);

  const applyRequestToSetup = useCallback(
    (forceClearDraft = false) => {
      setSetup((prev) => {
        const next = { ...prev };
        if (requestDefaults.startDate) next.startDate = requestDefaults.startDate;
        if (requestDefaults.completionDate) next.completionDate = requestDefaults.completionDate;
        if (requestDefaults.weeksToEventOverride) next.weeksToEventOverride = requestDefaults.weeksToEventOverride;
        if (requestDefaults.weeklyAvailabilityMinutes) next.weeklyAvailabilityMinutes = requestDefaults.weeklyAvailabilityMinutes;
        if (requestDefaults.weeklyAvailabilityDays.length) {
          next.weeklyAvailabilityDays = stableDayList(requestDefaults.weeklyAvailabilityDays);
        }
        if (requestDefaults.coachGuidanceText) {
          next.coachGuidanceText = requestDefaults.coachGuidanceText;
        }
        return next;
      });

      hasAutoSyncedRequestRef.current = true;
      if (forceClearDraft && draftPlanLatest?.id) {
        setDraftPlanLatest(null);
        setPublishStatus(null);
        setSessionDetailsById({});
        setInfo('Training request applied. Existing draft cleared. Generate a fresh weekly plan now.');
      } else {
        setInfo('Training request applied to block setup.');
      }
    },
    [draftPlanLatest?.id, requestDefaults]
  );

  useEffect(() => {
    if (hasAutoSyncedRequestRef.current) return;
    const hasRequestSignal =
      Boolean(requestDefaults.startDate) ||
      Boolean(requestDefaults.completionDate) ||
      Boolean(requestDefaults.weeksToEventOverride) ||
      Boolean(requestDefaults.weeklyAvailabilityMinutes) ||
      requestDefaults.weeklyAvailabilityDays.length > 0;
    if (!hasRequestSignal) return;
    applyRequestToSetup(false);
  }, [applyRequestToSetup, requestDefaults]);

  const openTrainingRequest = useCallback(async () => {
    setBusy('open-request');
    setError(null);
    setInfo(null);
    try {
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, {
        method: 'POST',
        data: { draftJson: buildDraftJsonFromTrainingRequest(trainingRequest) },
      });
      await fetchIntakeLifecycle();
      applyRequestToSetup(false);
      setInfo('Training request opened.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to open request.');
    } finally {
      setBusy(null);
    }
  }, [applyRequestToSetup, athleteId, fetchIntakeLifecycle, request, trainingRequest]);

  const saveTrainingRequestDraft = useCallback(async () => {
    const intakeResponseId = String(intakeLifecycle?.openDraftIntake?.id ?? '');
    if (!intakeResponseId) return;

    setBusy('save-request');
    setError(null);
    setInfo(null);
    try {
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, {
        method: 'PATCH',
        data: {
          intakeResponseId,
          draftJson: buildDraftJsonFromTrainingRequest(trainingRequest),
        },
      });
      await fetchIntakeLifecycle();
      applyRequestToSetup(false);
      setInfo('Training request draft saved.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to save request draft.');
    } finally {
      setBusy(null);
    }
  }, [applyRequestToSetup, athleteId, fetchIntakeLifecycle, intakeLifecycle?.openDraftIntake?.id, request, trainingRequest]);

  const markRequestComplete = useCallback(async () => {
    const intakeResponseId = String(intakeLifecycle?.openDraftIntake?.id ?? '');
    if (!intakeResponseId) return;

    setBusy('complete-request');
    setError(null);
    setInfo(null);
    try {
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, {
        method: 'PATCH',
        data: {
          intakeResponseId,
          draftJson: buildDraftJsonFromTrainingRequest(trainingRequest),
        },
      });
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`, {
        method: 'POST',
        data: { intakeResponseId },
      });
      await fetchIntakeLifecycle();
      applyRequestToSetup(false);
      setInfo('Training request marked complete.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to complete request.');
    } finally {
      setBusy(null);
    }
  }, [applyRequestToSetup, athleteId, fetchIntakeLifecycle, intakeLifecycle?.openDraftIntake?.id, request, trainingRequest]);

  const generateWeeklyPlan = useCallback(async () => {
    setBusy('generate-plan');
    setError(null);
    setInfo(null);

    try {
      if (!isDayKey(setup.startDate)) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Block start date is required.');
      }
      if (!isDayKey(setup.completionDate)) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Block completion date is required.');
      }
      if (!setup.weeklyAvailabilityDays.length) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Select at least one available day.');
      }
      if (!Number.isFinite(Number(setup.weeklyAvailabilityMinutes)) || Number(setup.weeklyAvailabilityMinutes) <= 0) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Weekly time budget must be greater than zero.');
      }

      const payload = {
        ...setup,
        startDate: setup.startDate,
        completionDate: setup.completionDate,
        eventDate: setup.completionDate,
        weeksToEvent: effectiveWeeksToCompletion,
        weeksToEventOverride: setup.weeksToEventOverride ?? undefined,
        weeklyAvailabilityDays: stableDayList(setup.weeklyAvailabilityDays),
        weeklyAvailabilityMinutes: Number(setup.weeklyAvailabilityMinutes),
        maxIntensityDaysPerWeek: Number(setup.maxIntensityDaysPerWeek),
        maxDoublesPerWeek: Number(setup.maxDoublesPerWeek),
        programPolicy: setup.programPolicy || undefined,
      };

      const data = await request<{ draftPlan: any }>(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`, {
        method: 'POST',
        data: { setup: payload },
      });

      setDraftPlanLatest(data.draftPlan ?? null);
      setSessionDetailsById({});
      if (data.draftPlan?.id) {
        await fetchPublishStatus(String(data.draftPlan.id));
      } else {
        setPublishStatus(null);
      }
      setInfo('Weekly plan generated. Review week tabs, then finalize and publish.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to generate plan.');
    } finally {
      setBusy(null);
    }
  }, [athleteId, effectiveWeeksToCompletion, fetchPublishStatus, request, setup]);

  const publishPlan = useCallback(async () => {
    const draftPlanId = String(draftPlanLatest?.id ?? '');
    if (!draftPlanId) return;

    setBusy('publish-plan');
    setError(null);
    setInfo(null);
    try {
      const data = await request<{ draftPlan: any; publish: any }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`,
        {
          method: 'POST',
          data: { aiPlanDraftId: draftPlanId },
        }
      );
      setDraftPlanLatest(data.draftPlan ?? null);
      await fetchPublishStatus(draftPlanId);
      setInfo('Plan approved and scheduled.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to publish plan.');
    } finally {
      setBusy(null);
    }
  }, [athleteId, draftPlanLatest?.id, fetchPublishStatus, request]);

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      const draftPlanId = String(draftPlanLatest?.id ?? '');
      if (!draftPlanId) return;

      setSessionDetailsById((prev) => ({
        ...prev,
        [sessionId]: { detailJson: prev[sessionId]?.detailJson ?? null, loading: true, error: null },
      }));

      try {
        const data = await request<{ detail: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/session-detail?draftPlanId=${encodeURIComponent(draftPlanId)}&sessionId=${encodeURIComponent(sessionId)}`
        );

        setSessionDetailsById((prev) => ({
          ...prev,
          [sessionId]: { detailJson: data.detail ?? null, loading: false, error: null },
        }));
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to load session detail.';
        setSessionDetailsById((prev) => ({
          ...prev,
          [sessionId]: { detailJson: prev[sessionId]?.detailJson ?? null, loading: false, error: message },
        }));
      }
    },
    [athleteId, draftPlanLatest?.id, request]
  );

  const hasOpenRequest = Boolean(intakeLifecycle?.lifecycle?.hasOpenRequest ?? intakeLifecycle?.openDraftIntake?.id);
  const hasDraft = Boolean(draftPlanLatest?.id);
  const isPublished = publishStatus?.visibilityStatus === 'PUBLISHED';
  const setupSync = useMemo(() => {
    const issues: string[] = [];
    if (requestDefaults.startDate && setup.startDate !== requestDefaults.startDate) issues.push('start date');
    if (requestDefaults.completionDate && setup.completionDate !== requestDefaults.completionDate) issues.push('completion date');
    if (requestDefaults.weeksToEventOverride && setup.weeksToEventOverride !== requestDefaults.weeksToEventOverride) issues.push('block length');
    if (
      requestDefaults.weeklyAvailabilityMinutes &&
      Number(setup.weeklyAvailabilityMinutes) !== Number(requestDefaults.weeklyAvailabilityMinutes)
    ) {
      issues.push('weekly minutes');
    }
    if (requestDefaults.weeklyAvailabilityDays.length) {
      const a = [...requestDefaults.weeklyAvailabilityDays].sort((x, y) => x - y);
      const b = [...setup.weeklyAvailabilityDays].sort((x, y) => x - y);
      if (!arraysEqual(a, b)) issues.push('available days');
    }
    const hasRequestValues =
      Boolean(requestDefaults.startDate) ||
      Boolean(requestDefaults.completionDate) ||
      Boolean(requestDefaults.weeksToEventOverride) ||
      Boolean(requestDefaults.weeklyAvailabilityMinutes) ||
      requestDefaults.weeklyAvailabilityDays.length > 0;
    return {
      hasRequestValues,
      inSync: hasRequestValues && issues.length === 0,
      issues,
    };
  }, [requestDefaults, setup]);
  const selectedWeekPosition = weekOptions.findIndex((w) => w.weekIndex === selectedWeekIndex);
  const prevWeekIndex = selectedWeekPosition > 0 ? weekOptions[selectedWeekPosition - 1]?.weekIndex : null;
  const nextWeekIndex =
    selectedWeekPosition >= 0 && selectedWeekPosition < weekOptions.length - 1
      ? weekOptions[selectedWeekPosition + 1]?.weekIndex
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Build This Athlete&apos;s Next Training Block</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">Complete request, generate weekly structure, finalize sessions, then schedule.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.location.reload()} disabled={busy != null}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {info ? <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-[var(--text)]">{info}</div> : null}

      <Block title="1) Training Request">
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            Step 1 of 3. Capture the event and constraints for this block.
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2">
            <div>Open request: <strong>{hasOpenRequest ? 'Yes' : 'No'}</strong></div>
            <div className="text-xs text-[var(--fg-muted)]">
              Latest submitted: {intakeLifecycle?.latestSubmittedIntake?.createdAt ? new Date(intakeLifecycle.latestSubmittedIntake.createdAt).toLocaleString() : 'None'}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Primary goal for this block</label>
              <Input
                value={trainingRequest.goalDetails}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, goalDetails: e.target.value }))}
                placeholder="e.g. Complete Olympic triathlon"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Goal focus</label>
              <Input
                value={trainingRequest.goalFocus}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, goalFocus: e.target.value }))}
                placeholder="e.g. Improve run durability"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Event name</label>
              <Input
                value={trainingRequest.eventName}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, eventName: e.target.value }))}
                placeholder="e.g. Noosa Triathlon"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Event date</label>
              <Input
                type="date"
                value={trainingRequest.eventDate}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, eventDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Target timeline</label>
              <Select
                value={trainingRequest.goalTimeline}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, goalTimeline: e.target.value }))}
              >
                <option value="">Select timeline</option>
                {GOAL_TIMELINE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Weekly time budget (minutes)</label>
              <Input
                value={trainingRequest.weeklyMinutes}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, weeklyMinutes: e.target.value }))}
                placeholder="e.g. 360"
                inputMode="numeric"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Available days</label>
            <div className="flex flex-wrap gap-2">
              {DAY_SHORTS.map((day) => {
                const selected = trainingRequest.availabilityDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      setTrainingRequest((prev) => ({
                        ...prev,
                        availabilityDays: selected
                          ? prev.availabilityDays.filter((d) => d !== day)
                          : [...prev.availabilityDays, day],
                      }))
                    }
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      selected
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)]'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Experience level</label>
              <Input
                value={trainingRequest.experienceLevel}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, experienceLevel: e.target.value }))}
                placeholder="e.g. Beginner"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Current injury or pain status</label>
              <Input
                value={trainingRequest.injuryStatus}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, injuryStatus: e.target.value }))}
                placeholder="e.g. Mild Achilles soreness"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Other constraints and coach notes</label>
            <Textarea
              value={trainingRequest.constraintsNotes}
              onChange={(e) => setTrainingRequest((p) => ({ ...p, constraintsNotes: e.target.value }))}
              rows={3}
              placeholder="e.g. Travel Tue-Thu next fortnight"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void openTrainingRequest()} disabled={busy != null || hasOpenRequest}>
              Open training request
            </Button>
            <Button variant="secondary" onClick={() => void saveTrainingRequestDraft()} disabled={busy != null || !hasOpenRequest}>
              Save request draft
            </Button>
            <Button variant="secondary" onClick={() => void markRequestComplete()} disabled={busy != null || !hasOpenRequest}>
              Mark request complete
            </Button>
          </div>
        </div>
      </Block>

      <Block title="2) Block Setup" rightAction={<Button onClick={() => void generateWeeklyPlan()} disabled={busy != null}>Generate weekly plan</Button>}>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            Step 2 of 3. Confirm structure and training limits before generation.
          </div>
          {!setupSync.hasRequestValues ? (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
              No request values to sync yet. Complete Step 1 first.
            </div>
          ) : setupSync.inSync ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Block Setup is synced with Step 1 request values.
            </div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Block Setup is out of sync with Step 1 for: {setupSync.issues.join(', ')}.
            </div>
          )}
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            Apply request values into setup before generation. If a draft already exists, applying will clear it and force a fresh build.
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => applyRequestToSetup(true)} disabled={busy != null}>
              Sync setup from request
            </Button>
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            Availability days are controlled in Step 1 (Training Request) to avoid duplicate inputs.
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Week starts on</label>
              <Select
                value={setup.weekStart}
                onChange={(e) => setSetup((prev) => ({ ...prev, weekStart: e.target.value as SetupState['weekStart'] }))}
              >
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Block start date</label>
              <Input type="date" value={setup.startDate} onChange={(e) => setSetup((p) => ({ ...p, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Block completion date</label>
              <Input
                type="date"
                value={setup.completionDate}
                onChange={(e) => setSetup((p) => ({ ...p, completionDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Block length (weeks)</label>
              <Input
                value={setup.weeksToEventOverride ?? ''}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  const parsed = Number(value);
                  setSetup((prev) => ({
                    ...prev,
                    weeksToEventOverride: value && Number.isFinite(parsed) ? Math.max(1, Math.min(52, Math.round(parsed))) : null,
                  }));
                }}
                inputMode="numeric"
                placeholder="Auto"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Weekly training time (minutes)</label>
              <Input
                value={setup.weeklyAvailabilityMinutes}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  setSetup((prev) => ({ ...prev, weeklyAvailabilityMinutes: Number.isFinite(parsed) ? parsed : 0 }));
                }}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Primary discipline focus</label>
              <Select
                value={setup.disciplineEmphasis}
                onChange={(e) => setSetup((prev) => ({ ...prev, disciplineEmphasis: e.target.value as SetupState['disciplineEmphasis'] }))}
              >
                <option value="balanced">Balanced</option>
                <option value="run">Run</option>
                <option value="bike">Bike</option>
                <option value="swim">Swim</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Risk tolerance</label>
              <Select
                value={setup.riskTolerance}
                onChange={(e) => setSetup((prev) => ({ ...prev, riskTolerance: e.target.value as SetupState['riskTolerance'] }))}
              >
                <option value="low">Conservative</option>
                <option value="med">Moderate</option>
                <option value="high">Aggressive</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Max intensity days per week</label>
              <Input
                value={setup.maxIntensityDaysPerWeek}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  setSetup((prev) => ({ ...prev, maxIntensityDaysPerWeek: Number.isFinite(parsed) ? Math.max(1, Math.min(3, parsed)) : 1 }));
                }}
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Max doubles per week</label>
              <Input
                value={setup.maxDoublesPerWeek}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  setSetup((prev) => ({ ...prev, maxDoublesPerWeek: Number.isFinite(parsed) ? Math.max(0, Math.min(3, parsed)) : 0 }));
                }}
                inputMode="numeric"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Coach priorities for this block</label>
            <Textarea
              value={setup.coachGuidanceText}
              onChange={(e) => setSetup((prev) => ({ ...prev, coachGuidanceText: e.target.value }))}
              rows={4}
              placeholder="Progression intent, constraints, injury caveats, and key weekly priorities"
            />
          </div>
        </div>
      </Block>

      <Block
        title="3) Weekly Plan Review"
        rightAction={
          <Button onClick={() => void publishPlan()} disabled={busy != null || !hasDraft}>
            Approve and schedule
          </Button>
        }
      >
        {!hasDraft ? (
          <div className="text-sm text-[var(--fg-muted)]">No draft yet. Generate weekly plan first.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
              Step 3 of 3. Review one week at a time, finalize session details, then approve and schedule.
            </div>
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
              Status: {isPublished ? 'Published to athlete calendar' : 'Draft only (hidden from athlete)'}
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">Select Week</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (prevWeekIndex != null) setSelectedWeekIndex(prevWeekIndex);
                  }}
                  disabled={busy != null || prevWeekIndex == null}
                >
                  Previous
                </Button>
                <div className="min-w-[240px] flex-1">
                  <Select
                    value={String(selectedWeekIndex)}
                    onChange={(e) => setSelectedWeekIndex(Number(e.target.value))}
                  >
                    {weekOptions.map((week) => (
                      <option key={week.weekIndex} value={String(week.weekIndex)}>
                        {week.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (nextWeekIndex != null) setSelectedWeekIndex(nextWeekIndex);
                  }}
                  disabled={busy != null || nextWeekIndex == null}
                >
                  Next
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)]">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                Week {selectedWeekIndex + 1} sessions ({selectedWeekSessions.length})
              </div>

              <div className="divide-y divide-[var(--border-subtle)]">
                {selectedWeekSessions.map((session) => {
                  const sessionId = String(session.id);
                  const lazyDetail = sessionDetailsById[sessionId]?.detailJson;
                  const parsed = sessionDetailV1Schema.safeParse(lazyDetail ?? session?.detailJson ?? null);
                  const detailText = parsed.success ? renderWorkoutDetailFromSessionDetailV1(parsed.data) : null;

                  return (
                    <div key={sessionId} className="space-y-2 px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">
                          {DAY_NAMES_SUN0[Number(session.dayOfWeek ?? 0)] ?? 'Day'} · {String(session.discipline ?? '').toUpperCase()} · {String(session.type ?? '')}
                        </div>
                        <div className="text-xs text-[var(--fg-muted)]">{Number(session.durationMinutes ?? 0)} min</div>
                      </div>

                      {session.notes ? <div className="text-xs text-[var(--fg-muted)]">{String(session.notes)}</div> : null}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void loadSessionDetail(sessionId)}
                          disabled={busy != null || sessionDetailsById[sessionId]?.loading}
                        >
                          {sessionDetailsById[sessionId]?.loading ? 'Loading...' : 'Finalize session details'}
                        </Button>
                      </div>

                      {sessionDetailsById[sessionId]?.error ? (
                        <div className="text-xs text-red-700">{sessionDetailsById[sessionId]?.error}</div>
                      ) : null}

                      {detailText ? (
                        <pre className="overflow-x-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs whitespace-pre-wrap">
                          {detailText}
                        </pre>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Block>
    </div>
  );
}
