/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError, useApi } from '@/components/api-client';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { addDaysToDayKey, isDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';
import { renderWorkoutDetailFromSessionDetailV1 } from '@/lib/workoutDetailRenderer';

import { DAY_NAMES_SUN0, dayOffsetFromWeekStart, daySortKey, normalizeWeekStart } from '../lib/week-start';
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
  primaryDisciplineFocus: '' | 'balanced' | 'swim' | 'bike' | 'run';
  eventName: string;
  eventDate: string;
  goalTimeline: string;
  weeklyMinutes: string;
  availabilityDays: string[];
  nonNegotiableDays: string[];
  preferredKeyDays: string[];
  dailyTimeWindows: Partial<Record<(typeof DAY_SHORTS)[number], 'any' | 'am' | 'midday' | 'pm' | 'evening'>>;
  experienceLevel: string;
  injuryStatus: string;
  disciplineInjuryNotes: string;
  equipment: '' | 'mixed' | 'trainer' | 'road' | 'treadmill' | 'pool' | 'gym';
  environmentTags: string[];
  fatigueState: '' | 'fresh' | 'normal' | 'fatigued' | 'cooked';
  availableTimeMinutes: string;
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
  coachGuidanceText: string;
};

type SessionEditorState = {
  sessionId: string;
  discipline: string;
  type: string;
  durationMinutes: string;
  notes: string;
  objective: string;
  blocks: Array<{ blockIndex: number; label: string; steps: string }>;
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
const DAY_SHORTS_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const GOAL_TIMELINE_OPTIONS = ['No date in mind', 'In 6-8 weeks', 'In 2-3 months', 'In 3-6 months', 'In 6-12 months'];
const EQUIPMENT_OPTIONS = [
  { value: '', label: 'Select equipment context' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'trainer', label: 'Bike trainer' },
  { value: 'road', label: 'Road/outdoor bike' },
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'pool', label: 'Pool access' },
  { value: 'gym', label: 'Gym access' },
] as const;
const ENVIRONMENT_OPTIONS = ['heat', 'hills', 'altitude', 'wind', 'indoor', 'outdoor'] as const;
const FATIGUE_OPTIONS = [
  { value: '', label: 'Select readiness' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'normal', label: 'Normal' },
  { value: 'fatigued', label: 'Fatigued' },
  { value: 'cooked', label: 'Cooked' },
] as const;
const TIME_WINDOW_OPTIONS = [
  { value: 'any', label: 'Any time' },
  { value: 'am', label: 'AM' },
  { value: 'midday', label: 'Midday' },
  { value: 'pm', label: 'PM' },
  { value: 'evening', label: 'Evening' },
] as const;

function formatApiErrorMessage(e: ApiClientError): string {
  if (e.status === 429 && e.code === 'LLM_RATE_LIMITED') return 'AI is temporarily busy. Please retry.';
  if (e.code === 'CONFIG_MISSING') return 'AI configuration unavailable right now.';
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
    primaryDisciplineFocus: deriveDisciplineEmphasis(profile?.disciplines ?? null),
    eventName: String(profile?.eventName ?? ''),
    eventDate: typeof profile?.eventDate === 'string' ? profile.eventDate.slice(0, 10) : '',
    goalTimeline: '',
    weeklyMinutes: profile?.weeklyMinutesTarget != null ? String(profile.weeklyMinutesTarget) : '',
    availabilityDays: dayShortsFromProfileDays(profile?.availableDays ?? null),
    nonNegotiableDays: [],
    preferredKeyDays: [],
    dailyTimeWindows: {},
    experienceLevel: String(profile?.experienceLevel ?? ''),
    injuryStatus: String(profile?.injuryStatus ?? ''),
    disciplineInjuryNotes: '',
    equipment: '',
    environmentTags: [],
    fatigueState: '',
    availableTimeMinutes: '',
    constraintsNotes: String(profile?.constraintsNotes ?? ''),
  };
}

function normalizeDayShortList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((d) => String(d ?? '').trim())
        .filter((d) => DAY_SHORTS.includes(d as any) || Object.keys(DAY_NAME_TO_SHORT).includes(d))
        .map((d) => (DAY_SHORTS.includes(d as any) ? d : DAY_NAME_TO_SHORT[d]))
    )
  );
}

function buildTrainingRequestFromDraftJson(raw: unknown): TrainingRequestForm {
  const map = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const availabilityDays = normalizeDayShortList(map.availability_days);
  const nonNegotiableDays = normalizeDayShortList(map.non_negotiable_days);
  const preferredKeyDays = normalizeDayShortList(map.preferred_key_days);
  const environmentTags = Array.isArray(map.environment_tags)
    ? Array.from(new Set(map.environment_tags.map((v) => String(v ?? '').toLowerCase().trim()).filter((v) => ENVIRONMENT_OPTIONS.includes(v as any))))
    : [];
  const equipmentValue = String(map.equipment ?? '').toLowerCase();
  const fatigueValue = String(map.fatigue_state ?? '').toLowerCase();
  const dailyTimeWindows = (() => {
    const out: Partial<Record<(typeof DAY_SHORTS)[number], 'any' | 'am' | 'midday' | 'pm' | 'evening'>> = {};
    const source = map.daily_time_windows && typeof map.daily_time_windows === 'object' ? (map.daily_time_windows as Record<string, unknown>) : {};
    for (const day of DAY_SHORTS) {
      const rawValue = String(source[day] ?? '').toLowerCase();
      if (rawValue === 'any' || rawValue === 'am' || rawValue === 'midday' || rawValue === 'pm' || rawValue === 'evening') {
        out[day] = rawValue;
      }
    }
    return out;
  })();

  return {
    goalDetails: String(map.goal_details ?? ''),
    goalFocus: String(map.goal_focus ?? ''),
    primaryDisciplineFocus:
      map.primary_discipline_focus === 'balanced' || map.primary_discipline_focus === 'swim' || map.primary_discipline_focus === 'bike' || map.primary_discipline_focus === 'run'
        ? (map.primary_discipline_focus as TrainingRequestForm['primaryDisciplineFocus'])
        : '',
    eventName: String(map.event_name ?? ''),
    eventDate: isDayKey(String(map.event_date ?? '')) ? String(map.event_date) : '',
    goalTimeline: String(map.goal_timeline ?? ''),
    weeklyMinutes: map.weekly_minutes != null ? String(map.weekly_minutes) : '',
    availabilityDays,
    nonNegotiableDays,
    preferredKeyDays,
    dailyTimeWindows,
    experienceLevel: String(map.experience_level ?? ''),
    injuryStatus: String(map.injury_status ?? ''),
    disciplineInjuryNotes: String(map.discipline_injury_notes ?? ''),
    equipment:
      equipmentValue === 'mixed' || equipmentValue === 'trainer' || equipmentValue === 'road' || equipmentValue === 'treadmill' || equipmentValue === 'pool' || equipmentValue === 'gym'
        ? (equipmentValue as TrainingRequestForm['equipment'])
        : '',
    environmentTags,
    fatigueState:
      fatigueValue === 'fresh' || fatigueValue === 'normal' || fatigueValue === 'fatigued' || fatigueValue === 'cooked'
        ? (fatigueValue as TrainingRequestForm['fatigueState'])
        : '',
    availableTimeMinutes: map.available_time_minutes != null ? String(map.available_time_minutes) : '',
    constraintsNotes: String(map.constraints_notes ?? ''),
  };
}

function buildDraftJsonFromTrainingRequest(form: TrainingRequestForm): Record<string, unknown> {
  return {
    goal_details: form.goalDetails.trim() || null,
    goal_focus: form.goalFocus.trim() || null,
    primary_discipline_focus: form.primaryDisciplineFocus || null,
    event_name: form.eventName.trim() || null,
    event_date: form.eventDate || null,
    goal_timeline: form.goalTimeline || null,
    weekly_minutes: form.weeklyMinutes ? Number(form.weeklyMinutes) : null,
    availability_days: form.availabilityDays,
    non_negotiable_days: form.nonNegotiableDays,
    preferred_key_days: form.preferredKeyDays,
    daily_time_windows: form.dailyTimeWindows,
    experience_level: form.experienceLevel.trim() || null,
    injury_status: form.injuryStatus.trim() || null,
    discipline_injury_notes: form.disciplineInjuryNotes.trim() || null,
    equipment: form.equipment || null,
    environment_tags: form.environmentTags,
    fatigue_state: form.fatigueState || null,
    available_time_minutes: form.availableTimeMinutes ? Number(form.availableTimeMinutes) : null,
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

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
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
    coachGuidanceText: '',
  };
}

function deriveWeeksToCompletionFromDates(params: { startDate: string; completionDate: string; weekStart: 'monday' | 'sunday' }): number | null {
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

function getWeekLabel(weekIndex: number, weekSessions: any[]): string {
  const dayKeys = weekSessions
    .map((s) => String(s?.dayKey ?? ''))
    .filter((dayKey) => isDayKey(dayKey))
    .sort();
  if (!dayKeys.length) return `Week ${weekIndex + 1}`;

  const start = parseDayKeyToUtcDate(dayKeys[0]);
  const end = parseDayKeyToUtcDate(dayKeys[dayKeys.length - 1]);
  const startLabel = `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${String(start.getUTCFullYear()).slice(-2)}`;
  const endLabel = `${String(end.getUTCDate()).padStart(2, '0')}/${String(end.getUTCMonth() + 1).padStart(2, '0')}/${String(end.getUTCFullYear()).slice(-2)}`;
  return `Week ${weekIndex + 1} (${startLabel} - ${endLabel})`;
}

function startOfWeekDayKeyWithWeekStart(dayKey: string, weekStart: 'monday' | 'sunday'): string {
  if (!isDayKey(dayKey)) return dayKey;
  const date = parseDayKeyToUtcDate(dayKey);
  const jsDay = date.getUTCDay();
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  return addDaysToDayKey(dayKey, -diff);
}

function formatDayKeyDate(dayKey: string): string {
  if (!isDayKey(dayKey)) return '';
  const d = parseDayKeyToUtcDate(dayKey);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function buildSessionEditorState(session: any, detailJson: unknown): SessionEditorState {
  const parsed = sessionDetailV1Schema.safeParse(detailJson ?? null);
  const blocks = parsed.success
    ? parsed.data.structure.map((b, idx) => ({
        blockIndex: idx,
        label: String(b.blockType ?? 'block').toUpperCase(),
        steps: String(b.steps ?? ''),
      }))
    : [];

  return {
    sessionId: String(session?.id ?? ''),
    discipline: String(session?.discipline ?? ''),
    type: String(session?.type ?? ''),
    durationMinutes: String(Number(session?.durationMinutes ?? 0) || ''),
    notes: String(session?.notes ?? ''),
    objective: parsed.success ? String(parsed.data.objective ?? '') : '',
    blocks,
  };
}

export function AiPlanBuilderCoachJourney({ athleteId }: { athleteId: string }) {
  const { request } = useApi();
  const hasAutoSyncedRequestRef = useRef(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [constraintErrors, setConstraintErrors] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);

  const [athleteProfile, setAthleteProfile] = useState<AthleteProfileSummary | null>(null);
  const [intakeLifecycle, setIntakeLifecycle] = useState<IntakeLifecycle | null>(null);
  const [draftPlanLatest, setDraftPlanLatest] = useState<any | null>(null);
  const [publishStatus, setPublishStatus] = useState<any | null>(null);

  const [trainingRequest, setTrainingRequest] = useState<TrainingRequestForm>(() => buildTrainingRequestFromProfile(null));
  const [setup, setSetup] = useState<SetupState>(() => buildSetupFromProfile(null));

  const [weekCarouselStart, setWeekCarouselStart] = useState<number>(0);
  const [sessionDetailsById, setSessionDetailsById] = useState<Record<string, { detailJson: any | null; loading: boolean; error?: string | null }>>({});
  const [detailGenerationScope, setDetailGenerationScope] = useState<'selected-week' | 'entire-plan'>('selected-week');
  const [detailGenerationWeekIndex, setDetailGenerationWeekIndex] = useState<number | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionEditor, setSessionEditor] = useState<SessionEditorState | null>(null);
  const [agentScope, setAgentScope] = useState<'session' | 'week' | 'plan'>('week');
  const [agentWeekIndex, setAgentWeekIndex] = useState<number | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [agentInstruction, setAgentInstruction] = useState<string>('');
  const [generateProgress, setGenerateProgress] = useState<number | null>(null);
  const [generateEtaSeconds, setGenerateEtaSeconds] = useState<number | null>(null);
  const generateProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const effectiveWeekStart = useMemo(
    () => normalizeWeekStart((draftPlanLatest as any)?.setupJson?.weekStart ?? setup.weekStart),
    [draftPlanLatest, setup.weekStart]
  );

  const effectiveWeeksToCompletion = useMemo(() => {
    if (setup.weeksToEventOverride && setup.weeksToEventOverride >= 1) return setup.weeksToEventOverride;
    return deriveWeeksToCompletionFromDates({ startDate: setup.startDate, completionDate: setup.completionDate, weekStart: setup.weekStart }) ?? 12;
  }, [setup]);

  const requestDefaults = useMemo(() => {
    const completionDate = isDayKey(trainingRequest.eventDate) ? trainingRequest.eventDate : null;
    const weeksToEventOverride = goalTimelineToWeeks(trainingRequest.goalTimeline);
    const startDate = completionDate && weeksToEventOverride ? subtractWeeksFromDayKey(completionDate, weeksToEventOverride) : null;
    const weeklyAvailabilityMinutes = Number(trainingRequest.weeklyMinutes);
    const weeklyAvailabilityDaysRaw = dayIndicesFromShorts(trainingRequest.availabilityDays);
    const nonNegotiableDayIdx = new Set(dayIndicesFromShorts(trainingRequest.nonNegotiableDays));
    const weeklyAvailabilityDays = weeklyAvailabilityDaysRaw.filter((d) => !nonNegotiableDayIdx.has(d));
    const preferredKeyDays = trainingRequest.preferredKeyDays.filter((d) => !trainingRequest.nonNegotiableDays.includes(d));
    const dailyWindowsText = DAY_SHORTS_MON_FIRST.map((day) => {
      const v = trainingRequest.dailyTimeWindows[day as (typeof DAY_SHORTS)[number]];
      if (!v || v === 'any') return null;
      return `${day}:${v.toUpperCase()}`;
    })
      .filter(Boolean)
      .join(', ');

    const coachGuidanceText = [
      trainingRequest.goalDetails.trim(),
      trainingRequest.goalFocus.trim() ? `Focus: ${trainingRequest.goalFocus.trim()}` : '',
      trainingRequest.experienceLevel.trim() ? `Experience: ${trainingRequest.experienceLevel.trim()}` : '',
      trainingRequest.constraintsNotes.trim() ? `Constraints: ${trainingRequest.constraintsNotes.trim()}` : '',
      trainingRequest.injuryStatus.trim() ? `Injury/Pain: ${trainingRequest.injuryStatus.trim()}` : '',
      trainingRequest.disciplineInjuryNotes.trim() ? `Discipline injury notes: ${trainingRequest.disciplineInjuryNotes.trim()}` : '',
      trainingRequest.equipment ? `Equipment: ${trainingRequest.equipment}` : '',
      trainingRequest.environmentTags.length ? `Environment: ${trainingRequest.environmentTags.join(', ')}` : '',
      trainingRequest.fatigueState ? `Readiness: ${trainingRequest.fatigueState}` : '',
      trainingRequest.availableTimeMinutes ? `Typical session time: ${trainingRequest.availableTimeMinutes} min` : '',
      trainingRequest.nonNegotiableDays.length ? `Non-negotiable off days: ${trainingRequest.nonNegotiableDays.join(', ')}` : '',
      preferredKeyDays.length ? `Preferred key days: ${preferredKeyDays.join(', ')}` : '',
      dailyWindowsText ? `Daily windows: ${dailyWindowsText}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      startDate,
      completionDate,
      weeksToEventOverride,
      weeklyAvailabilityMinutes: Number.isFinite(weeklyAvailabilityMinutes) && weeklyAvailabilityMinutes > 0 ? weeklyAvailabilityMinutes : null,
      weeklyAvailabilityDays,
      disciplineEmphasis:
        trainingRequest.primaryDisciplineFocus === 'balanced' ||
        trainingRequest.primaryDisciplineFocus === 'swim' ||
        trainingRequest.primaryDisciplineFocus === 'bike' ||
        trainingRequest.primaryDisciplineFocus === 'run'
          ? trainingRequest.primaryDisciplineFocus
          : null,
      coachGuidanceText: coachGuidanceText || null,
    };
  }, [trainingRequest]);

  const applyRequestToSetup = useCallback(
    (forceClearDraft = false) => {
      setSetup((prev) => {
        const next = { ...prev };
        if (requestDefaults.startDate) next.startDate = requestDefaults.startDate;
        if (requestDefaults.completionDate) next.completionDate = requestDefaults.completionDate;
        if (requestDefaults.weeksToEventOverride) next.weeksToEventOverride = requestDefaults.weeksToEventOverride;
        if (requestDefaults.weeklyAvailabilityMinutes) next.weeklyAvailabilityMinutes = requestDefaults.weeklyAvailabilityMinutes;
        if (requestDefaults.weeklyAvailabilityDays.length) next.weeklyAvailabilityDays = stableDayList(requestDefaults.weeklyAvailabilityDays);
        if (requestDefaults.disciplineEmphasis) next.disciplineEmphasis = requestDefaults.disciplineEmphasis;
        if (requestDefaults.coachGuidanceText) next.coachGuidanceText = requestDefaults.coachGuidanceText;
        return next;
      });

      hasAutoSyncedRequestRef.current = true;
      if (forceClearDraft && draftPlanLatest?.id) {
        setDraftPlanLatest(null);
        setPublishStatus(null);
        setSessionDetailsById({});
        setInfo('Request synced. Existing draft cleared. Generate a new weekly structure.');
      } else {
        setInfo('Request synced into block blueprint.');
      }
    },
    [draftPlanLatest?.id, requestDefaults]
  );

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
  }, [draftPlanLatest?.sessions, effectiveWeekStart]);

  const weekCards = useMemo(
    () =>
      sessionsByWeek.map(([weekIndex, weekSessions]) => ({
        weekIndex,
        label: getWeekLabel(weekIndex, weekSessions),
        totalMinutes: weekSessions.reduce((sum, s) => sum + Number(s?.durationMinutes ?? 0), 0),
        sessions: weekSessions,
      })),
    [sessionsByWeek]
  );
  const visibleWeekCards = useMemo(() => weekCards.slice(weekCarouselStart, weekCarouselStart + 4), [weekCards, weekCarouselStart]);
  const weekOptions = useMemo(() => weekCards.map((w) => ({ value: w.weekIndex, label: w.label })), [weekCards]);
  const detailGenerationWeek = useMemo(
    () => weekCards.find((w) => w.weekIndex === detailGenerationWeekIndex) ?? weekCards[0] ?? null,
    [detailGenerationWeekIndex, weekCards]
  );
  const agentWeek = useMemo(() => weekCards.find((w) => w.weekIndex === agentWeekIndex) ?? weekCards[0] ?? null, [agentWeekIndex, weekCards]);
  const agentSessionOptions = useMemo(
    () =>
      (agentWeek?.sessions ?? []).map((s: any) => ({
        value: String(s.id),
        label: `${DAY_NAMES_SUN0[Number(s?.dayOfWeek ?? 0)] ?? 'Day'} ${String(s?.discipline ?? '').toUpperCase()} - ${String(s?.type ?? '').toLowerCase()}`,
      })),
    [agentWeek?.sessions]
  );

  const setupStartDayKey =
    typeof draftPlanLatest?.setupJson?.startDate === 'string' && isDayKey(draftPlanLatest.setupJson.startDate)
      ? String(draftPlanLatest.setupJson.startDate)
      : isDayKey(setup.startDate)
        ? setup.startDate
        : null;
  const weekZeroStart = useMemo(
    () => (setupStartDayKey ? startOfWeekDayKeyWithWeekStart(setupStartDayKey, effectiveWeekStart) : null),
    [effectiveWeekStart, setupStartDayKey]
  );

  const formatSessionHeadline = useCallback(
    (session: any): string => {
      const directDayKey = String(session?.dayKey ?? '');
      const computedDayKey =
        weekZeroStart && Number.isFinite(Number(session?.weekIndex)) && Number.isFinite(Number(session?.dayOfWeek))
          ? addDaysToDayKey(
              weekZeroStart,
              Number(session.weekIndex ?? 0) * 7 + dayOffsetFromWeekStart(Number(session.dayOfWeek ?? 0), effectiveWeekStart)
            )
          : '';
      const dayKey = isDayKey(directDayKey) ? directDayKey : computedDayKey;
      const discipline = String(session?.discipline ?? '').toUpperCase();
      const type = String(session?.type ?? '').toLowerCase();
      const fallbackDay = DAY_NAMES_SUN0[Number(session?.dayOfWeek ?? 0)] ?? 'Day';
      if (isDayKey(dayKey)) {
        const d = parseDayKeyToUtcDate(dayKey);
        const dayShort = DAY_SHORTS[d.getUTCDay()] ?? fallbackDay;
        return `${dayShort} (${formatDayKeyDate(dayKey)}) ${discipline} - ${type}`;
      }
      return `${fallbackDay} ${discipline} - ${type}`;
    },
    [effectiveWeekStart, weekZeroStart]
  );

  const setupSync = useMemo(() => {
    const issues: string[] = [];
    if (requestDefaults.startDate && setup.startDate !== requestDefaults.startDate) issues.push('start date');
    if (requestDefaults.completionDate && setup.completionDate !== requestDefaults.completionDate) issues.push('completion date');
    if (requestDefaults.weeksToEventOverride && setup.weeksToEventOverride !== requestDefaults.weeksToEventOverride) issues.push('block length');
    if (requestDefaults.weeklyAvailabilityMinutes && Number(setup.weeklyAvailabilityMinutes) !== Number(requestDefaults.weeklyAvailabilityMinutes)) {
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

    return { hasRequestValues, inSync: hasRequestValues && issues.length === 0, issues };
  }, [requestDefaults, setup]);

  const hasOpenRequest = Boolean(intakeLifecycle?.lifecycle?.hasOpenRequest ?? intakeLifecycle?.openDraftIntake?.id);
  const hasSubmittedRequest = Boolean(intakeLifecycle?.latestSubmittedIntake?.id);
  const requestStatus: 'none' | 'draft' | 'submitted' = hasOpenRequest ? 'draft' : hasSubmittedRequest ? 'submitted' : 'none';
  const requestStatusLabel =
    requestStatus === 'draft' ? 'Step 1 in progress: request draft open' : requestStatus === 'submitted' ? 'Step 1 complete: request submitted' : 'Step 1 not started';
  const requestStatusToneClass =
    requestStatus === 'draft'
      ? 'border-blue-300 bg-blue-50 text-blue-900'
      : requestStatus === 'submitted'
        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
        : 'border-[var(--border-subtle)] bg-[var(--bg-structure)] text-[var(--fg-muted)]';
  const requestGuidanceText =
    requestStatus === 'draft'
      ? 'You are editing the request. Next: Submit request when details are ready.'
      : requestStatus === 'submitted'
        ? 'Next: Review Block Blueprint and click Generate weekly structure.'
        : 'Next: Start new request to capture this training block.';
  const hasDraft = Boolean(draftPlanLatest?.id);
  const isPublished = publishStatus?.visibilityStatus === 'PUBLISHED';
  const requestContextApplied = useMemo(() => {
    const source = (draftPlanLatest as any)?.setupJson?.requestContextApplied;
    return source && typeof source === 'object' ? (source as Record<string, unknown>) : null;
  }, [draftPlanLatest]);

  const isBlueprintReady = hasSubmittedRequest && setupSync.inSync;
  const hasWeeklyDraft = hasDraft && weekCards.length > 0;

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
    const data = await request<{ draftPlan: any | null }>(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/latest`);
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
        const [profile, intake, draft] = await Promise.all([fetchAthleteProfile(), fetchIntakeLifecycle(), fetchDraftPlanLatest()]);
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

        if (draft?.id) await fetchPublishStatus(String(draft.id));
        else setPublishStatus(null);
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
    if (!weekCards.length) {
      setWeekCarouselStart(0);
      return;
    }
    if (weekCarouselStart >= weekCards.length) {
      setWeekCarouselStart(Math.max(0, weekCards.length - 4));
    }
  }, [weekCards, weekCarouselStart]);

  useEffect(() => {
    if (!weekCards.length) {
      setDetailGenerationWeekIndex(null);
      return;
    }
    const firstWeek = weekCards[0]?.weekIndex ?? null;
    setDetailGenerationWeekIndex((prev) => (prev == null || !weekCards.some((w) => w.weekIndex === prev) ? firstWeek : prev));
  }, [weekCards]);

  useEffect(() => {
    if (!weekCards.length) {
      setAgentWeekIndex(null);
      setAgentSessionId(null);
      return;
    }
    const firstWeek = weekCards[0]?.weekIndex ?? null;
    setAgentWeekIndex((prev) => (prev == null || !weekCards.some((w) => w.weekIndex === prev) ? firstWeek : prev));
  }, [weekCards]);

  useEffect(() => {
    if (!agentSessionOptions.length) {
      setAgentSessionId(null);
      return;
    }
    setAgentSessionId((prev) => (prev && agentSessionOptions.some((s) => s.value === prev) ? prev : agentSessionOptions[0]!.value));
  }, [agentSessionOptions]);

  useEffect(() => {
    return () => {
      if (generateProgressTimerRef.current) {
        clearInterval(generateProgressTimerRef.current);
        generateProgressTimerRef.current = null;
      }
    };
  }, []);

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
      setInfo('Draft request started. You can now edit and save.');
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
        data: { intakeResponseId, draftJson: buildDraftJsonFromTrainingRequest(trainingRequest) },
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
        data: { intakeResponseId, draftJson: buildDraftJsonFromTrainingRequest(trainingRequest) },
      });
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`, {
        method: 'POST',
        data: { intakeResponseId },
      });
      await fetchIntakeLifecycle();
      applyRequestToSetup(false);
      setInfo('Request submitted. Continue to Block Blueprint.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to complete request.');
    } finally {
      setBusy(null);
    }
  }, [applyRequestToSetup, athleteId, fetchIntakeLifecycle, intakeLifecycle?.openDraftIntake?.id, request, trainingRequest]);

  const generateWeeklyStructure = useCallback(async () => {
    const startProgress = () => {
      const expectedSeconds = Math.max(10, Math.min(40, Math.round(effectiveWeeksToCompletion * 0.7)));
      const startedAt = Date.now();
      setGenerateProgress(6);
      setGenerateEtaSeconds(expectedSeconds);
      if (generateProgressTimerRef.current) clearInterval(generateProgressTimerRef.current);
      generateProgressTimerRef.current = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        const ratio = Math.min(0.92, elapsedSec / expectedSeconds);
        setGenerateProgress(Math.max(6, Math.round(ratio * 100)));
        setGenerateEtaSeconds(Math.max(0, expectedSeconds - elapsedSec));
      }, 400);
    };
    const stopProgress = (success: boolean) => {
      if (generateProgressTimerRef.current) clearInterval(generateProgressTimerRef.current);
      generateProgressTimerRef.current = null;
      if (success) {
        setGenerateProgress(100);
        setGenerateEtaSeconds(0);
        setTimeout(() => {
          setGenerateProgress(null);
          setGenerateEtaSeconds(null);
        }, 350);
      } else {
        setGenerateProgress(null);
        setGenerateEtaSeconds(null);
      }
    };

    setBusy('generate-plan');
    setError(null);
    setConstraintErrors([]);
    setInfo(null);
    startProgress();

    try {
      if (!isDayKey(setup.startDate)) throw new ApiClientError(400, 'VALIDATION_ERROR', 'Block start date is required.');
      if (!isDayKey(setup.completionDate)) throw new ApiClientError(400, 'VALIDATION_ERROR', 'Block completion date is required.');
      if (!setup.weeklyAvailabilityDays.length) throw new ApiClientError(400, 'VALIDATION_ERROR', 'Available days are required in Step 1.');
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
        disciplineEmphasis: (trainingRequest.primaryDisciplineFocus || setup.disciplineEmphasis) as SetupState['disciplineEmphasis'],
        requestContext: {
          goalDetails: trainingRequest.goalDetails || undefined,
          goalFocus: trainingRequest.goalFocus || undefined,
          primaryDisciplineFocus: trainingRequest.primaryDisciplineFocus || undefined,
          eventName: trainingRequest.eventName || undefined,
          eventDate: trainingRequest.eventDate || undefined,
          goalTimeline: trainingRequest.goalTimeline || undefined,
          weeklyMinutes: trainingRequest.weeklyMinutes ? Number(trainingRequest.weeklyMinutes) : undefined,
          availabilityDays: trainingRequest.availabilityDays,
          nonNegotiableDays: trainingRequest.nonNegotiableDays,
          preferredKeyDays: trainingRequest.preferredKeyDays,
          dailyTimeWindows: trainingRequest.dailyTimeWindows,
          experienceLevel: trainingRequest.experienceLevel || undefined,
          injuryStatus: trainingRequest.injuryStatus || undefined,
          disciplineInjuryNotes: trainingRequest.disciplineInjuryNotes || undefined,
          equipment: trainingRequest.equipment || undefined,
          environmentTags: trainingRequest.environmentTags.length ? trainingRequest.environmentTags : undefined,
          fatigueState: trainingRequest.fatigueState || undefined,
          availableTimeMinutes: trainingRequest.availableTimeMinutes ? Number(trainingRequest.availableTimeMinutes) : undefined,
          constraintsNotes: trainingRequest.constraintsNotes || undefined,
        },
      };

      const data = await request<{ draftPlan: any }>(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`, {
        method: 'POST',
        data: { setup: payload },
      });

      setDraftPlanLatest(data.draftPlan ?? null);
      setSessionDetailsById({});
      setWeekCarouselStart(0);
      if (data.draftPlan?.id) await fetchPublishStatus(String(data.draftPlan.id));
      else setPublishStatus(null);
      setInfo('Weekly structure generated. Continue to week-by-week review.');
      stopProgress(true);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'PLAN_CONSTRAINT_VIOLATION') {
        const violations = Array.isArray(e.diagnostics?.violations) ? (e.diagnostics?.violations as Array<{ message?: unknown }>) : [];
        const messages = violations
          .map((v) => (typeof v?.message === 'string' ? v.message : null))
          .filter((m): m is string => Boolean(m))
          .slice(0, 8);
        setConstraintErrors(messages);
      }
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to generate weekly structure.');
      stopProgress(false);
    } finally {
      setBusy(null);
    }
  }, [athleteId, effectiveWeeksToCompletion, fetchPublishStatus, request, setup, trainingRequest]);

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      const draftPlanId = String(draftPlanLatest?.id ?? '');
      if (!draftPlanId) return null;

      setSessionDetailsById((prev) => ({ ...prev, [sessionId]: { detailJson: prev[sessionId]?.detailJson ?? null, loading: true, error: null } }));
      try {
        const data = await request<{ detail: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/session-detail?draftPlanId=${encodeURIComponent(draftPlanId)}&sessionId=${encodeURIComponent(sessionId)}`
        );
        setSessionDetailsById((prev) => ({ ...prev, [sessionId]: { detailJson: data.detail ?? null, loading: false, error: null } }));
        return data.detail ?? null;
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to load session detail.';
        setSessionDetailsById((prev) => ({ ...prev, [sessionId]: { detailJson: prev[sessionId]?.detailJson ?? null, loading: false, error: message } }));
        return null;
      }
    },
    [athleteId, draftPlanLatest?.id, request]
  );

  const loadAllDetailsForWeek = useCallback(async (sessions: any[]) => {
    if (!sessions.length) return;
    setBusy('load-week-details');
    setError(null);
    setInfo(null);
    try {
      for (const session of sessions) {
        await loadSessionDetail(String(session.id));
      }
      setInfo('Session details generated for this week.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to generate week details.');
    } finally {
      setBusy(null);
    }
  }, [loadSessionDetail]);

  const loadDetailsForScope = useCallback(async () => {
    const allSessions = Array.isArray(draftPlanLatest?.sessions) ? draftPlanLatest.sessions : [];
    const sessionsForScope = detailGenerationScope === 'entire-plan' ? allSessions : detailGenerationWeek?.sessions ?? [];
    if (!sessionsForScope.length) return;
    await loadAllDetailsForWeek(sessionsForScope);
  }, [detailGenerationScope, detailGenerationWeek?.sessions, draftPlanLatest?.sessions, loadAllDetailsForWeek]);

  const openSessionEditor = useCallback(
    async (session: any) => {
      const sessionId = String(session?.id ?? '');
      if (!sessionId) return;

      let hydratedDetail = sessionDetailsById[sessionId]?.detailJson ?? session?.detailJson ?? null;
      if (!hydratedDetail) {
        hydratedDetail = await loadSessionDetail(sessionId);
      }
      setEditingSessionId(sessionId);
      setSessionEditor(buildSessionEditorState(session, hydratedDetail));
    },
    [loadSessionDetail, sessionDetailsById]
  );

  const saveSessionEditor = useCallback(async () => {
    if (!sessionEditor || !draftPlanLatest?.id) return;
    const duration = Number(sessionEditor.durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      setError('Session duration must be a positive number.');
      return;
    }

    setBusy('save-session-edit');
    setError(null);
    setInfo(null);
    try {
      const payload = {
        draftPlanId: String(draftPlanLatest.id),
        sessionEdits: [
          {
            sessionId: sessionEditor.sessionId,
            discipline: sessionEditor.discipline.trim() || undefined,
            type: sessionEditor.type.trim() || undefined,
            durationMinutes: Math.round(duration),
            notes: sessionEditor.notes.trim() || null,
            objective: sessionEditor.objective.trim() || null,
            blockEdits: sessionEditor.blocks
              .map((b) => ({ blockIndex: b.blockIndex, steps: b.steps.trim() }))
              .filter((b) => b.steps.length > 0),
          },
        ],
      };

      const data = await request<{ draftPlan: any }>(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`, {
        method: 'PATCH',
        data: payload,
      });
      setDraftPlanLatest(data.draftPlan ?? null);
      const updatedSession = Array.isArray(data.draftPlan?.sessions)
        ? data.draftPlan.sessions.find((s: any) => String(s.id) === sessionEditor.sessionId)
        : null;
      if (updatedSession?.detailJson) {
        setSessionDetailsById((prev) => ({
          ...prev,
          [sessionEditor.sessionId]: {
            detailJson: updatedSession.detailJson,
            loading: false,
            error: null,
          },
        }));
      }
      setInfo('Session updated.');
      setEditingSessionId(null);
      setSessionEditor(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to save session edits.');
    } finally {
      setBusy(null);
    }
  }, [athleteId, draftPlanLatest?.id, request, sessionEditor]);

  const applyAgentAdjustment = useCallback(async () => {
    const draftPlanId = String(draftPlanLatest?.id ?? '');
    const instruction = agentInstruction.trim();
    if (!draftPlanId) return;
    if (instruction.length < 3) {
      setError('Enter an adjustment instruction for CoachKit AI.');
      return;
    }

    const body: Record<string, unknown> = {
      draftPlanId,
      scope: agentScope,
      instruction,
    };
    if (agentScope === 'week') body.weekIndex = agentWeek?.weekIndex ?? null;
    if (agentScope === 'session') body.sessionId = agentSessionId;

    setBusy('agent-adjust');
    setError(null);
    setInfo(null);
    try {
      const data = await request<{ draftPlan: any; appliedCount: number }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/agent-adjust`,
        {
          method: 'POST',
          data: body,
        }
      );
      setDraftPlanLatest(data.draftPlan ?? null);
      setSessionDetailsById({});
      setEditingSessionId(null);
      setSessionEditor(null);
      setInfo(`CoachKit AI applied ${Number(data.appliedCount ?? 0)} adjustment${Number(data.appliedCount ?? 0) === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to apply AI adjustment.');
    } finally {
      setBusy(null);
    }
  }, [agentInstruction, agentScope, agentSessionId, agentWeek?.weekIndex, athleteId, draftPlanLatest?.id, request]);

  const shareSkeletonWithAthlete = useCallback(async () => {
    if (!sessionsByWeek.length) return;
    setBusy('share-skeleton');
    setError(null);
    setInfo(null);
    try {
      const weekLines = sessionsByWeek.map(([weekIndex, sessions]) => {
        const label = getWeekLabel(weekIndex, sessions);
        const summary = sessions
          .map((session) => {
            const day = DAY_NAMES_SUN0[Number(session.dayOfWeek ?? 0)] ?? 'Day';
            const discipline = String(session.discipline ?? '').toUpperCase();
            const type = String(session.type ?? '');
            const minutes = Number(session.durationMinutes ?? 0);
            return `${day}: ${discipline} ${type} (${minutes} min)`;
          })
          .join('; ');
        return `${label} — ${summary}`;
      });

      const body = [
        `Draft training block summary for review (${weekLines.length} weeks).`,
        '',
        ...weekLines,
        '',
        'Reply with any requested changes before final publish.',
      ].join('\n');

      await request('/api/messages/send', {
        method: 'POST',
        data: { body, recipients: { athleteIds: [athleteId] } },
      });
      setInfo('Skeleton summary shared with athlete via Messages.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to share skeleton with athlete.');
    } finally {
      setBusy(null);
    }
  }, [athleteId, request, sessionsByWeek]);

  const publishPlan = useCallback(async () => {
    const draftPlanId = String(draftPlanLatest?.id ?? '');
    if (!draftPlanId) return;

    setBusy('publish-plan');
    setError(null);
    setInfo(null);
    try {
      const data = await request<{ draftPlan: any; publish: any }>(`/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`, {
        method: 'POST',
        data: { aiPlanDraftId: draftPlanId },
      });
      setDraftPlanLatest(data.draftPlan ?? null);
      await fetchPublishStatus(draftPlanId);
      setInfo('Plan published to athlete and coach calendars.');
    } catch (e) {
      setError(e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to publish plan.');
    } finally {
      setBusy(null);
    }
  }, [athleteId, draftPlanLatest?.id, fetchPublishStatus, request]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Build This Athlete&apos;s Next Training Block</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">Follow the steps: capture request, confirm blueprint, review weekly draft, publish.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.location.reload()} disabled={busy != null}>Refresh</Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div className={`rounded-md border px-3 py-2 text-xs ${hasSubmittedRequest ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--fg-muted)]'}`}>
          <div className="font-medium">Step 1 Request</div>
          <div>{hasSubmittedRequest ? 'Complete' : hasOpenRequest ? 'In progress' : 'Not started'}</div>
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs ${isBlueprintReady ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--fg-muted)]'}`}>
          <div className="font-medium">Step 2 Blueprint</div>
          <div>{isBlueprintReady ? 'Ready to generate' : 'Waiting for request submit/sync'}</div>
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs ${hasWeeklyDraft ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--fg-muted)]'}`}>
          <div className="font-medium">Step 3 Weekly Draft</div>
          <div>{hasWeeklyDraft ? 'Generated' : 'Pending generation'}</div>
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs ${isPublished ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--fg-muted)]'}`}>
          <div className="font-medium">Step 4 Publish</div>
          <div>{isPublished ? 'Published' : 'Not published yet'}</div>
        </div>
      </div>

      {generateProgress != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/15">
          <div className="w-[min(560px,90vw)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-lg">
            <div className="text-sm font-medium">Generating weekly structure...</div>
            <div className="mt-1 text-xs text-[var(--fg-muted)]">
              {generateEtaSeconds != null ? `Estimated remaining: ${Math.max(0, generateEtaSeconds)}s` : 'Estimating...'}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-structure)]">
              <div
                className="h-full rounded-full bg-[var(--primary)] transition-all duration-300"
                style={{ width: `${Math.max(4, Math.min(100, generateProgress))}%` }}
              />
            </div>
            <div className="mt-2 text-right text-xs text-[var(--fg-muted)]">{Math.max(1, Math.min(100, Math.round(generateProgress)))}%</div>
          </div>
        </div>
      ) : null}

      {error ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {constraintErrors.length ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-medium">Constraint issues found:</div>
          <ul className="mt-1 list-disc pl-5">
            {constraintErrors.map((message, idx) => (
              <li key={`${idx}:${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {info ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</div> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Block title="1) Training Request">
          <div className="space-y-3 text-sm">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            Capture or update this athlete&apos;s block request. Only one open request can be edited at a time.
          </div>
          <div className={`rounded-md border px-3 py-2 ${requestStatusToneClass}`}>
            <div className="font-medium">{requestStatusLabel}</div>
            <div className="text-xs">{requestGuidanceText}</div>
            <div className="text-xs text-[var(--fg-muted)]">
              Latest submitted: {intakeLifecycle?.latestSubmittedIntake?.createdAt ? new Date(intakeLifecycle.latestSubmittedIntake.createdAt).toLocaleString() : 'None'}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Primary goal</label>
              <Input value={trainingRequest.goalDetails} onChange={(e) => setTrainingRequest((p) => ({ ...p, goalDetails: e.target.value }))} disabled={!hasOpenRequest} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Goal focus</label>
              <Input value={trainingRequest.goalFocus} onChange={(e) => setTrainingRequest((p) => ({ ...p, goalFocus: e.target.value }))} disabled={!hasOpenRequest} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Primary discipline focus</label>
              <Select
                value={trainingRequest.primaryDisciplineFocus}
                onChange={(e) =>
                  setTrainingRequest((p) => ({
                    ...p,
                    primaryDisciplineFocus: (e.target.value || '') as TrainingRequestForm['primaryDisciplineFocus'],
                  }))
                }
                disabled={!hasOpenRequest}
              >
                <option value="">Select focus</option>
                <option value="balanced">Balanced</option>
                <option value="run">Run</option>
                <option value="bike">Bike</option>
                <option value="swim">Swim</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Event name</label>
              <Input value={trainingRequest.eventName} onChange={(e) => setTrainingRequest((p) => ({ ...p, eventName: e.target.value }))} disabled={!hasOpenRequest} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Event date</label>
              <Input type="date" value={trainingRequest.eventDate} onChange={(e) => setTrainingRequest((p) => ({ ...p, eventDate: e.target.value }))} disabled={!hasOpenRequest} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Target timeline</label>
              <Select value={trainingRequest.goalTimeline} onChange={(e) => setTrainingRequest((p) => ({ ...p, goalTimeline: e.target.value }))} disabled={!hasOpenRequest}>
                <option value="">Select timeline</option>
                {GOAL_TIMELINE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Weekly time budget (minutes)</label>
              <Input value={trainingRequest.weeklyMinutes} onChange={(e) => setTrainingRequest((p) => ({ ...p, weeklyMinutes: e.target.value }))} inputMode="numeric" disabled={!hasOpenRequest} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Available days</label>
            <div className="flex flex-wrap gap-2">
              {DAY_SHORTS_MON_FIRST.map((day) => {
                const selected = trainingRequest.availabilityDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!hasOpenRequest}
                    onClick={() =>
                      setTrainingRequest((prev) => ({
                        ...prev,
                        availabilityDays: selected ? prev.availabilityDays.filter((d) => d !== day) : [...prev.availabilityDays, day],
                      }))
                    }
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      selected ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)]'
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
              <label className="mb-1 block text-xs font-medium">Non-negotiable off days</label>
              <div className="flex flex-wrap gap-2">
                {DAY_SHORTS_MON_FIRST.map((day) => {
                  const selected = trainingRequest.nonNegotiableDays.includes(day);
                  return (
                    <button
                      key={`off:${day}`}
                      type="button"
                      disabled={!hasOpenRequest}
                      onClick={() =>
                        setTrainingRequest((prev) => ({
                          ...prev,
                          nonNegotiableDays: selected ? prev.nonNegotiableDays.filter((d) => d !== day) : [...prev.nonNegotiableDays, day],
                          availabilityDays: selected ? prev.availabilityDays : prev.availabilityDays.filter((d) => d !== day),
                          preferredKeyDays: selected ? prev.preferredKeyDays : prev.preferredKeyDays.filter((d) => d !== day),
                        }))
                      }
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        selected ? 'border-rose-500 bg-rose-500 text-white' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)]'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Preferred key-session days</label>
              <div className="flex flex-wrap gap-2">
                {DAY_SHORTS_MON_FIRST.map((day) => {
                  const selected = trainingRequest.preferredKeyDays.includes(day);
                  const disabled = !hasOpenRequest || trainingRequest.nonNegotiableDays.includes(day);
                  return (
                    <button
                      key={`key:${day}`}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setTrainingRequest((prev) => ({
                          ...prev,
                          preferredKeyDays: selected ? prev.preferredKeyDays.filter((d) => d !== day) : [...prev.preferredKeyDays, day],
                        }))
                      }
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        selected ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)]'
                      } ${disabled && !selected ? 'opacity-50' : ''}`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Daily time windows (optional)</label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {DAY_SHORTS_MON_FIRST.map((day) => (
                <div key={`window:${day}`}>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">{day}</label>
                  <Select
                    value={trainingRequest.dailyTimeWindows[day as (typeof DAY_SHORTS)[number]] ?? 'any'}
                    onChange={(e) =>
                      setTrainingRequest((prev) => ({
                        ...prev,
                        dailyTimeWindows: {
                          ...prev.dailyTimeWindows,
                          [day]: e.target.value as 'any' | 'am' | 'midday' | 'pm' | 'evening',
                        },
                      }))
                    }
                    disabled={!hasOpenRequest}
                  >
                    {TIME_WINDOW_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Experience level</label>
              <Input value={trainingRequest.experienceLevel} onChange={(e) => setTrainingRequest((p) => ({ ...p, experienceLevel: e.target.value }))} disabled={!hasOpenRequest} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Current injury/pain status</label>
              <Input value={trainingRequest.injuryStatus} onChange={(e) => setTrainingRequest((p) => ({ ...p, injuryStatus: e.target.value }))} disabled={!hasOpenRequest} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Discipline-specific injury limits</label>
              <Input
                value={trainingRequest.disciplineInjuryNotes}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, disciplineInjuryNotes: e.target.value }))}
                disabled={!hasOpenRequest}
                placeholder="e.g. No downhill run reps while shin settles"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Typical single-session time available (minutes)</label>
              <Input
                value={trainingRequest.availableTimeMinutes}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, availableTimeMinutes: e.target.value }))}
                inputMode="numeric"
                disabled={!hasOpenRequest}
                placeholder="e.g. 60"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Equipment context</label>
              <Select
                value={trainingRequest.equipment}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, equipment: e.target.value as TrainingRequestForm['equipment'] }))}
                disabled={!hasOpenRequest}
              >
                {EQUIPMENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Current readiness / fatigue</label>
              <Select
                value={trainingRequest.fatigueState}
                onChange={(e) => setTrainingRequest((p) => ({ ...p, fatigueState: e.target.value as TrainingRequestForm['fatigueState'] }))}
                disabled={!hasOpenRequest}
              >
                {FATIGUE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Environment factors</label>
            <div className="flex flex-wrap gap-2">
              {ENVIRONMENT_OPTIONS.map((tag) => {
                const selected = trainingRequest.environmentTags.includes(tag);
                return (
                  <button
                    key={`env:${tag}`}
                    type="button"
                    disabled={!hasOpenRequest}
                    onClick={() =>
                      setTrainingRequest((prev) => ({
                        ...prev,
                        environmentTags: selected ? prev.environmentTags.filter((v) => v !== tag) : [...prev.environmentTags, tag],
                      }))
                    }
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      selected ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)]'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Constraints and coach notes</label>
            <Textarea value={trainingRequest.constraintsNotes} onChange={(e) => setTrainingRequest((p) => ({ ...p, constraintsNotes: e.target.value }))} rows={3} disabled={!hasOpenRequest} />
          </div>

          {!hasOpenRequest ? (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
              Read-only mode. Click Start new request to edit these fields.
            </div>
          ) : null}

            <div className="flex flex-wrap gap-2">
              {!hasOpenRequest ? (
                <Button onClick={() => void openTrainingRequest()} disabled={busy != null}>
                  {hasSubmittedRequest ? 'Start revision request' : 'Start new request'}
                </Button>
              ) : (
                <>
                  <Button onClick={() => void saveTrainingRequestDraft()} disabled={busy != null}>Save draft</Button>
                  <Button variant="secondary" onClick={() => void markRequestComplete()} disabled={busy != null}>Submit request</Button>
                </>
              )}
            </div>
          </div>
        </Block>

        <Block title="2) Block Blueprint" rightAction={<Button onClick={() => void generateWeeklyStructure()} disabled={busy != null}>Generate weekly structure</Button>}>
          <div className="space-y-3 text-sm">
          {setupSync.inSync ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Blueprint is aligned with the request. Next: Generate weekly structure.</div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Blueprint needs update {setupSync.issues.length ? `for: ${setupSync.issues.join(', ')}` : 'from request values'}. Click Sync blueprint from request.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => applyRequestToSetup(true)} disabled={busy != null}>Sync blueprint from request</Button>
            <span className="text-xs text-[var(--fg-muted)]">Coach plan library is managed in <Link className="underline" href="/coach/settings">Settings</Link>.</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Block length (weeks)</label>
              <Input
                value={setup.weeksToEventOverride ?? ''}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  const parsed = Number(value);
                  setSetup((prev) => ({ ...prev, weeksToEventOverride: value && Number.isFinite(parsed) ? Math.max(1, Math.min(52, Math.round(parsed))) : null }));
                }}
                inputMode="numeric"
                placeholder="Auto"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Block start date</label>
              <Input type="date" value={setup.startDate} onChange={(e) => setSetup((p) => ({ ...p, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Block completion date</label>
              <Input type="date" value={setup.completionDate} onChange={(e) => setSetup((p) => ({ ...p, completionDate: e.target.value }))} />
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
            <div>
              <label className="mb-1 block text-xs font-medium">Risk tolerance</label>
              <Select value={setup.riskTolerance} onChange={(e) => setSetup((prev) => ({ ...prev, riskTolerance: e.target.value as SetupState['riskTolerance'] }))}>
                <option value="low">Conservative</option>
                <option value="med">Moderate</option>
                <option value="high">Aggressive</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Max doubles/week</label>
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

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            <div className="mb-1 font-medium text-[var(--text)]">Applied request inputs</div>
            <ul className="list-disc pl-4">
              {requestContextApplied && Array.isArray(requestContextApplied.effects) && requestContextApplied.effects.length ? (
                (requestContextApplied.effects as unknown[]).map((effect, idx) => (
                  <li key={`${idx}:${String(effect)}`}>{String(effect)}</li>
                ))
              ) : (
                <li>No explicit effects recorded yet. Generate weekly structure after updating the request.</li>
              )}
            </ul>
          </div>
          </div>
        </Block>
      </div>

      <Block title="3) Week-by-Week Draft Review">
        {!hasDraft ? (
          <div className="text-sm text-[var(--fg-muted)]">No draft generated yet. Complete Step 2 and generate weekly structure.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
              Share skeleton with athlete for review, then generate detailed sessions by selected week or entire plan.
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">Skeleton sharing</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" disabled={busy != null || !sessionsByWeek.length} onClick={() => void shareSkeletonWithAthlete()}>
                  Share skeleton with athlete
                </Button>
                <span className="text-xs text-[var(--fg-muted)]">Sends week-level draft summary to Messages for athlete feedback.</span>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">Detail generation</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[220px] flex-1">
                  <Select value={detailGenerationScope} onChange={(e) => setDetailGenerationScope(e.target.value as 'selected-week' | 'entire-plan')}>
                    <option value="selected-week">Selected week only</option>
                    <option value="entire-plan">Entire plan</option>
                  </Select>
                </div>
                {detailGenerationScope === 'selected-week' ? (
                  <div className="min-w-[260px] flex-1">
                    <Select value={String(detailGenerationWeek?.weekIndex ?? '')} onChange={(e) => setDetailGenerationWeekIndex(Number(e.target.value))}>
                      {weekOptions.map((w) => (
                        <option key={w.value} value={String(w.value)}>
                          {w.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    busy != null ||
                    (detailGenerationScope === 'selected-week'
                      ? !detailGenerationWeek || detailGenerationWeek.sessions.length === 0
                      : !Array.isArray(draftPlanLatest?.sessions) || draftPlanLatest.sessions.length === 0)
                  }
                  onClick={() => void loadDetailsForScope()}
                >
                  {detailGenerationScope === 'entire-plan' ? 'Generate details for entire plan' : 'Generate details for selected week'}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">CoachKit AI adjustment</div>
              <div className="grid gap-2 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Scope</label>
                  <Select value={agentScope} onChange={(e) => setAgentScope(e.target.value as 'session' | 'week' | 'plan')}>
                    <option value="session">Single session</option>
                    <option value="week">Selected week</option>
                    <option value="plan">Entire plan</option>
                  </Select>
                </div>
                {agentScope !== 'plan' ? (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Week</label>
                    <Select value={String(agentWeek?.weekIndex ?? '')} onChange={(e) => setAgentWeekIndex(Number(e.target.value))}>
                      {weekOptions.map((w) => (
                        <option key={w.value} value={String(w.value)}>
                          {w.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
                {agentScope === 'session' ? (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Session</label>
                    <Select value={String(agentSessionId ?? '')} onChange={(e) => setAgentSessionId(e.target.value)}>
                      <option value="">Select session</option>
                      {agentSessionOptions.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
              </div>
              <div className="mt-2">
                <Textarea
                  value={agentInstruction}
                  onChange={(e) => setAgentInstruction(e.target.value)}
                  rows={2}
                  placeholder="Examples: Reduce intensity by 1 level and cut 10 min. | Main set: 4 x 6 min @ tempo with 2 min easy. | Make this week recovery focused."
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy != null || !agentInstruction.trim() || (agentScope === 'session' && !agentSessionId)}
                  onClick={() => void applyAgentAdjustment()}
                >
                  Apply AI adjustment
                </Button>
                <span className="text-xs text-[var(--fg-muted)]">Applies immediately to session/week/plan based on your instruction.</span>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">Week Carousel</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy != null || weekCarouselStart <= 0}
                  onClick={() => setWeekCarouselStart((p) => Math.max(0, p - 4))}
                >
                  Previous
                </Button>
                <div className="min-w-[220px] flex-1 text-xs text-[var(--fg-muted)]">
                  Showing weeks {weekCards.length ? weekCarouselStart + 1 : 0}-
                  {Math.min(weekCarouselStart + 4, weekCards.length)} of {weekCards.length}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy != null || weekCarouselStart + 4 >= weekCards.length}
                  onClick={() => setWeekCarouselStart((p) => Math.min(Math.max(0, weekCards.length - 1), p + 4))}
                >
                  Next
                </Button>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-4 md:grid-cols-2">
              {visibleWeekCards.map((week) => (
                <div key={week.weekIndex} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                  <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2">
                    <div className="text-xs font-medium">{week.label}</div>
                    <div className="text-xs text-[var(--fg-muted)]">{week.sessions.length} sessions · {week.totalMinutes} min</div>
                  </div>
                  <div className="space-y-2 px-3 py-3">
                    <div className="space-y-2">
                      {week.sessions.map((session) => {
                        const sessionId = String(session.id);
                        const lazyDetail = sessionDetailsById[sessionId]?.detailJson;
                        const parsed = sessionDetailV1Schema.safeParse(lazyDetail ?? session?.detailJson ?? null);
                        const detailText = parsed.success ? renderWorkoutDetailFromSessionDetailV1(parsed.data) : null;
                        return (
                          <div key={sessionId} className="rounded-md border border-[var(--border-subtle)] px-2 py-2">
                            <div className="text-xs font-medium">{formatSessionHeadline(session)}</div>
                            <div className="text-[11px] text-[var(--fg-muted)]">{Number(session.durationMinutes ?? 0)} min</div>
                            {session.notes ? <div className="mt-1 text-[11px] text-[var(--fg-muted)]">{String(session.notes)}</div> : null}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => void openSessionEditor(session)}>
                                {editingSessionId === sessionId ? 'Editing...' : 'Edit session'}
                              </Button>
                            </div>
                            {sessionDetailsById[sessionId]?.loading ? <div className="mt-2 text-[11px] text-[var(--fg-muted)]">Generating details...</div> : null}
                            {sessionDetailsById[sessionId]?.error ? <div className="mt-1 text-[11px] text-red-700">{sessionDetailsById[sessionId]?.error}</div> : null}
                            {editingSessionId === sessionId && sessionEditor ? (
                              <div className="mt-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
                                <div className="grid gap-2 sm:grid-cols-3">
                                  <div>
                                    <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Discipline</label>
                                    <Select
                                      value={sessionEditor.discipline}
                                      onChange={(e) => setSessionEditor((prev) => (prev ? { ...prev, discipline: e.target.value } : prev))}
                                    >
                                      <option value="swim">Swim</option>
                                      <option value="bike">Bike</option>
                                      <option value="run">Run</option>
                                      <option value="strength">Strength</option>
                                    </Select>
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Type</label>
                                    <Select
                                      value={sessionEditor.type}
                                      onChange={(e) => setSessionEditor((prev) => (prev ? { ...prev, type: e.target.value } : prev))}
                                    >
                                      <option value="endurance">Endurance</option>
                                      <option value="tempo">Tempo</option>
                                      <option value="threshold">Threshold</option>
                                      <option value="technique">Technique</option>
                                      <option value="recovery">Recovery</option>
                                      <option value="strength">Strength</option>
                                    </Select>
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Duration (min)</label>
                                    <Input
                                      value={sessionEditor.durationMinutes}
                                      onChange={(e) => setSessionEditor((prev) => (prev ? { ...prev, durationMinutes: e.target.value } : prev))}
                                      inputMode="numeric"
                                    />
                                  </div>
                                </div>
                                <div className="mt-2">
                                  <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Objective</label>
                                  <Input
                                    value={sessionEditor.objective}
                                    onChange={(e) => setSessionEditor((prev) => (prev ? { ...prev, objective: e.target.value } : prev))}
                                  />
                                </div>
                                <div className="mt-2">
                                  <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">Session notes</label>
                                  <Textarea
                                    value={sessionEditor.notes}
                                    onChange={(e) => setSessionEditor((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                                    rows={2}
                                  />
                                </div>
                                {sessionEditor.blocks.length ? (
                                  <div className="mt-2 space-y-2">
                                    {sessionEditor.blocks.map((block) => (
                                      <div key={`${block.blockIndex}:${block.label}`}>
                                        <label className="mb-1 block text-[11px] font-medium text-[var(--fg-muted)]">
                                          {block.label} steps
                                        </label>
                                        <Textarea
                                          value={block.steps}
                                          onChange={(e) =>
                                            setSessionEditor((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    blocks: prev.blocks.map((b) => (b.blockIndex === block.blockIndex ? { ...b, steps: e.target.value } : b)),
                                                  }
                                                : prev
                                            )
                                          }
                                          rows={2}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-2 flex gap-2">
                                  <Button size="sm" onClick={() => void saveSessionEditor()} disabled={busy != null}>
                                    Save session changes
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                      setEditingSessionId(null);
                                      setSessionEditor(null);
                                    }}
                                    disabled={busy != null}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                            {detailText ? (
                              <pre className="mt-2 max-h-48 overflow-x-auto overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-2 py-2 text-[11px] whitespace-pre-wrap">
                                {detailText}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Block>

      <Block title="4) Approve and Publish" rightAction={<Button disabled={busy != null || !hasDraft} onClick={() => void publishPlan()}>Publish plan</Button>}>
        <div className="space-y-2 text-sm">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            Athlete sees only the currently published version. Drafts remain hidden until publish.
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm">
            Current status: <strong>{isPublished ? 'Published' : hasDraft ? 'Draft (not visible to athlete)' : 'No draft yet'}</strong>
          </div>
        </div>
      </Block>
    </div>
  );
}
