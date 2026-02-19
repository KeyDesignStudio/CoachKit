import type { PlanReasoningV1 } from '@/lib/ai/plan-reasoning/types';
/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

import { ApiClientError, useApi } from '@/components/api-client';

import { DAY_NAMES_SUN0, daySortKey, normalizeWeekStart, orderedDayIndices } from '../lib/week-start';
import { addDaysToDayKey, getTodayDayKey, isDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';

const ReviewPlanSection = dynamic(
  () => import('./AiPlanBuilderReviewPlanSection').then((mod) => mod.AiPlanBuilderReviewPlanSection),
  { ssr: false }
);

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
  programPolicy: '' | 'COUCH_TO_5K' | 'COUCH_TO_IRONMAN_26' | 'HALF_TO_FULL_MARATHON';
  selectedPlanSourceVersionId: string;
};

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

type ReferencePlanOption = {
  planSourceVersionId: string;
  planSourceId: string;
  title: string;
  sport: string;
  distance: string;
  level: string;
  durationWeeks: number;
  recommended: boolean;
  score: number | null;
  reasons: string[];
};

type CommandAction = {
  id: string;
  label: string;
  keywords: string;
  disabled: boolean;
  run: () => void;
};

type PerformanceModelPreview = {
  current: { dayKey: string; ctl: number; atl: number; tsb: number };
  projected: { dayKey: string; ctl: number; atl: number; tsb: number };
  delta: { ctl: number; atl: number; tsb: number };
  upcoming: { days: number; plannedLoad: number; avgDailyLoad: number };
};

type AdaptationSuggestion = {
  id: string;
  label: string;
  guidance: string;
};

type WeekStats = {
  sessions: number;
  totalMinutes: number;
  intensity: number;
};

type IntakeLifecycle = {
  intakeResponse?: any | null;
  latestSubmittedIntake: any | null;
  openDraftIntake: any | null;
  lifecycle?: { hasOpenRequest: boolean; canOpenNewRequest: boolean } | null;
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
const DAY_SHORTS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GOAL_TIMELINE_OPTIONS = ['No date in mind', 'In 6-8 weeks', 'In 2-3 months', 'In 3-6 months', 'In 6-12 months'];

function dayShortsFromProfileDays(days: string[] | null | undefined): string[] {
  if (!Array.isArray(days)) return [];
  const normalized = days
    .map((d) => {
      const trimmed = String(d ?? '').trim();
      if (!trimmed) return null;
      return DAY_NAME_TO_SHORT[trimmed] ?? (DAY_SHORTS.includes(trimmed) ? trimmed : null);
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
    .filter((d) => DAY_SHORTS.includes(d) || Object.keys(DAY_NAME_TO_SHORT).includes(d))
    .map((d) => (DAY_SHORTS.includes(d) ? d : DAY_NAME_TO_SHORT[d]));

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
  if (!value) return null;
  if (value === 'In 6-8 weeks') return 8;
  if (value === 'In 2-3 months') return 12;
  if (value === 'In 3-6 months') return 24;
  if (value === 'In 6-12 months') return 48;
  return null;
}

function dayIndicesFromShorts(days: string[]): number[] {
  return Array.from(
    new Set(
      (Array.isArray(days) ? days : [])
        .map((d) => {
          const idx = DAY_SHORTS.indexOf(String(d ?? '').trim());
          return idx >= 0 ? idx : null;
        })
        .filter((d): d is number => d != null)
    )
  ).sort((a, b) => a - b);
}

function subtractWeeksFromDayKey(dayKey: string, weeks: number): string {
  if (!isDayKey(dayKey) || !Number.isFinite(weeks) || weeks <= 1) return dayKey;
  const date = parseDayKeyToUtcDate(dayKey);
  date.setUTCDate(date.getUTCDate() - (weeks - 1) * 7);
  return date.toISOString().slice(0, 10);
}

function normalizeDayKeyLike(value: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (isDayKey(text)) return text;
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const candidate = `${yyyy}-${mm}-${dd}`;
  return isDayKey(candidate) ? candidate : null;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeDayIndices(days: string[] | null | undefined): number[] {
  if (!Array.isArray(days)) return [];
  return days
    .map((d) => DAY_NAME_TO_INDEX[String(d).trim()] ?? null)
    .filter((d): d is number => typeof d === 'number')
    .filter((d, idx, arr) => arr.indexOf(d) === idx)
    .sort((a, b) => a - b);
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
    selectedPlanSourceVersionId: '',
  };
}

function applyPolicyPreset(setup: SetupState, weeksToCompletion: number | null): SetupState {
  const weeks = Math.max(1, Math.min(52, weeksToCompletion ?? setup.weeksToEventOverride ?? 12));
  if (setup.programPolicy === 'COUCH_TO_5K') {
    return {
      ...setup,
      disciplineEmphasis: 'run',
      riskTolerance: 'low',
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      weeklyAvailabilityMinutes: Math.max(150, Math.min(260, setup.weeklyAvailabilityMinutes || 200)),
      weeksToEventOverride: weeks,
      coachGuidanceText:
        setup.coachGuidanceText ||
        "Novice progression. Keep one quality run max per week and emphasize consistency and recovery.",
    };
  }
  if (setup.programPolicy === 'COUCH_TO_IRONMAN_26') {
    return {
      ...setup,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: Math.min(2, Math.max(1, setup.maxIntensityDaysPerWeek)),
      maxDoublesPerWeek: Math.max(1, setup.maxDoublesPerWeek),
      weeklyAvailabilityMinutes: Math.max(600, Math.min(1000, setup.weeklyAvailabilityMinutes || 820)),
      weeksToEventOverride: Math.max(24, weeks),
      coachGuidanceText:
        setup.coachGuidanceText ||
        'Progressive triathlon build with regular recovery weeks and discipline balance anchored to bike durability.',
    };
  }
  if (setup.programPolicy === 'HALF_TO_FULL_MARATHON') {
    return {
      ...setup,
      disciplineEmphasis: 'run',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: Math.min(2, Math.max(1, setup.maxIntensityDaysPerWeek)),
      maxDoublesPerWeek: Math.min(1, setup.maxDoublesPerWeek),
      weeklyAvailabilityMinutes: Math.max(360, Math.min(650, setup.weeklyAvailabilityMinutes || 520)),
      weeksToEventOverride: Math.max(12, weeks),
      coachGuidanceText:
        setup.coachGuidanceText ||
        'Bridge from half-marathon readiness to full marathon durability with long-run progression and controlled intensity.',
    };
  }
  return setup;
}

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

function buildAdaptationSuggestions(adaptationMemory: any | null): AdaptationSuggestion[] {
  if (!adaptationMemory || typeof adaptationMemory !== 'object') return [];

  const completionRate = Number(adaptationMemory.completionRate ?? 0);
  const skipRate = Number(adaptationMemory.skipRate ?? 0);
  const sorenessRate = Number(adaptationMemory.sorenessRate ?? 0);
  const painRate = Number(adaptationMemory.painRate ?? 0);
  const avgRpe = Number(adaptationMemory.avgRpe ?? 0);

  const suggestions: AdaptationSuggestion[] = [];

  if (painRate >= 0.15 || sorenessRate >= 0.35) {
    suggestions.push({
      id: 'protect-recovery',
      label: 'Protect recovery this week',
      guidance:
        'Reduce intensity density this week: cap to one hard day, remove doubles, and keep key sessions aerobic until pain and soreness trends improve.',
    });
  }

  if (completionRate < 0.7 || skipRate > 0.25) {
    suggestions.push({
      id: 'reset-consistency',
      label: 'Reset for consistency',
      guidance:
        'Lower weekly load by about 10-15% and prioritize consistency sessions on available days before rebuilding progression.',
    });
  }

  if (avgRpe >= 7.5) {
    suggestions.push({
      id: 'de-load-fatigue',
      label: 'Deload fatigue',
      guidance:
        'Insert a deload microcycle: maintain frequency, reduce total duration, and keep intensity controlled to bring perceived effort back to target.',
    });
  }

  if (completionRate >= 0.9 && painRate < 0.05 && sorenessRate < 0.2 && avgRpe > 0 && avgRpe <= 6.5) {
    suggestions.push({
      id: 'progress-build',
      label: 'Progress the build',
      guidance:
        'Athlete is tolerating training well. Progress load gradually with one key quality session and one longer endurance session in the week.',
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      id: 'hold-steady',
      label: 'Hold current progression',
      guidance:
        'Current readiness signal is mixed but stable. Keep progression conservative and monitor compliance, soreness, and pain before increasing load.',
    });
  }

  return suggestions;
}

export function AiPlanBuilderCoachV1({ athleteId }: { athleteId: string }) {
  const { request } = useApi();
  const router = useRouter();

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
  const [sessionDetailsById, setSessionDetailsById] = useState<
    Record<string, { detailJson: any | null; loading: boolean; error?: string | null }>
  >({});
  const [reviewSideMode, setReviewSideMode] = useState<'reference' | 'previous'>('reference');
  const [selectedCompareWeekIndex, setSelectedCompareWeekIndex] = useState<number | null>(null);
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const [referencePlanOptions, setReferencePlanOptions] = useState<ReferencePlanOption[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const [performanceModel, setPerformanceModel] = useState<PerformanceModelPreview | null>(null);
  const [intakeLifecycle, setIntakeLifecycle] = useState<IntakeLifecycle | null>(null);
  const [trainingRequest, setTrainingRequest] = useState<TrainingRequestForm>(() => buildTrainingRequestFromProfile(null));
  const [requestApplyMessage, setRequestApplyMessage] = useState<string>('');

  const [setup, setSetup] = useState<SetupState>(() => buildSetupFromProfile(null));
  const [athleteProfile, setAthleteProfile] = useState<AthleteProfileSummary | null>(null);
  const [buildProgress, setBuildProgress] = useState<string | null>(null);
  const buildProgressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const setupSeededForAthlete = useRef<string | null>(null);
  const reviewSentinelRef = useRef<HTMLDivElement | null>(null);
  const shouldDeferReview = process.env.NODE_ENV === 'production';
  const [reviewInView, setReviewInView] = useState(!shouldDeferReview);
  const [reviewReady, setReviewReady] = useState(!shouldDeferReview);
  const lastRequestDefaultsKeyRef = useRef<string>('');
  const lastAutoGuidanceRef = useRef<string>('');

  const effectiveWeekStart = useMemo(
    () => normalizeWeekStart((draftPlanLatest as any)?.setupJson?.weekStart ?? setup.weekStart),
    [draftPlanLatest, setup.weekStart]
  );

  const orderedDays = useMemo(() => orderedDayIndices(effectiveWeekStart), [effectiveWeekStart]);

  const requestSetupDefaults = useMemo(() => {
    const completionDate = normalizeDayKeyLike(trainingRequest.eventDate);
    const weeksToEventOverride = goalTimelineToWeeks(trainingRequest.goalTimeline);
    const startDate = completionDate && weeksToEventOverride ? subtractWeeksFromDayKey(completionDate, weeksToEventOverride) : null;
    const weeklyAvailabilityMinutes = Number(trainingRequest.weeklyMinutes);
    const weeklyAvailabilityDays = dayIndicesFromShorts(trainingRequest.availabilityDays);
    const guidanceParts = [
      trainingRequest.goalDetails.trim(),
      trainingRequest.goalFocus.trim() ? `Focus: ${trainingRequest.goalFocus.trim()}` : '',
      trainingRequest.constraintsNotes.trim() ? `Constraints: ${trainingRequest.constraintsNotes.trim()}` : '',
      trainingRequest.injuryStatus.trim() ? `Injury/Pain: ${trainingRequest.injuryStatus.trim()}` : '',
    ].filter(Boolean);
    const coachGuidanceText = guidanceParts.join('\n');

    return {
      completionDate,
      startDate,
      weeksToEventOverride,
      weeklyAvailabilityMinutes: Number.isFinite(weeklyAvailabilityMinutes) && weeklyAvailabilityMinutes > 0 ? weeklyAvailabilityMinutes : null,
      weeklyAvailabilityDays,
      coachGuidanceText: coachGuidanceText || null,
    };
  }, [trainingRequest]);

  const setupSourceLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    if (requestSetupDefaults.completionDate && setup.completionDate === requestSetupDefaults.completionDate) {
      labels.completionDate = 'From request';
    }
    if (requestSetupDefaults.weeksToEventOverride && setup.weeksToEventOverride === requestSetupDefaults.weeksToEventOverride) {
      labels.weeksToEventOverride = 'From request';
    }
    if (
      requestSetupDefaults.weeklyAvailabilityMinutes &&
      Number(setup.weeklyAvailabilityMinutes) === Number(requestSetupDefaults.weeklyAvailabilityMinutes)
    ) {
      labels.weeklyAvailabilityMinutes = 'From request';
    }
    if (
      requestSetupDefaults.weeklyAvailabilityDays.length &&
      arraysEqual(
        [...setup.weeklyAvailabilityDays].sort((a, b) => a - b),
        [...requestSetupDefaults.weeklyAvailabilityDays].sort((a, b) => a - b)
      )
    ) {
      labels.weeklyAvailabilityDays = 'From request';
    }
    if (requestSetupDefaults.coachGuidanceText && setup.coachGuidanceText === requestSetupDefaults.coachGuidanceText) {
      labels.coachGuidanceText = 'From request';
    }
    return labels;
  }, [requestSetupDefaults, setup]);

  const applyRequestDefaultsToSetup = useCallback(
    (options?: { force?: boolean }) => {
      const draftExists = Boolean(draftPlanLatest?.id);
      if (draftExists && !options?.force) return;
      const key = JSON.stringify(requestSetupDefaults);
      if (!options?.force && key === lastRequestDefaultsKeyRef.current) return;
      lastRequestDefaultsKeyRef.current = key;

      let appliedCount = 0;
      setSetup((prev) => {
        const next = { ...prev };
        if (requestSetupDefaults.completionDate) {
          if (next.completionDate !== requestSetupDefaults.completionDate) appliedCount += 1;
          next.completionDate = requestSetupDefaults.completionDate;
        }
        if (requestSetupDefaults.startDate) {
          if (next.startDate !== requestSetupDefaults.startDate) appliedCount += 1;
          next.startDate = requestSetupDefaults.startDate;
        }
        if (requestSetupDefaults.weeksToEventOverride) {
          if (next.weeksToEventOverride !== requestSetupDefaults.weeksToEventOverride) appliedCount += 1;
          next.weeksToEventOverride = requestSetupDefaults.weeksToEventOverride;
        }
        if (requestSetupDefaults.weeklyAvailabilityMinutes) {
          if (Number(next.weeklyAvailabilityMinutes) !== Number(requestSetupDefaults.weeklyAvailabilityMinutes)) appliedCount += 1;
          next.weeklyAvailabilityMinutes = requestSetupDefaults.weeklyAvailabilityMinutes;
        }
        if (requestSetupDefaults.weeklyAvailabilityDays.length) {
          if (!arraysEqual([...next.weeklyAvailabilityDays].sort((a, b) => a - b), [...requestSetupDefaults.weeklyAvailabilityDays].sort((a, b) => a - b))) {
            appliedCount += 1;
          }
          next.weeklyAvailabilityDays = requestSetupDefaults.weeklyAvailabilityDays;
        }
        if (requestSetupDefaults.coachGuidanceText) {
          if (!prev.coachGuidanceText || prev.coachGuidanceText === lastAutoGuidanceRef.current || options?.force) {
            if (next.coachGuidanceText !== requestSetupDefaults.coachGuidanceText) appliedCount += 1;
            next.coachGuidanceText = requestSetupDefaults.coachGuidanceText;
            lastAutoGuidanceRef.current = requestSetupDefaults.coachGuidanceText;
          }
        }
        return next;
      });

      setDraftPlanLatest((prev: any) => {
        if (!prev || !prev.setupJson) return prev;
        return {
          ...prev,
          setupJson: {
            ...prev.setupJson,
            ...(requestSetupDefaults.completionDate ? { completionDate: requestSetupDefaults.completionDate, eventDate: requestSetupDefaults.completionDate } : {}),
            ...(requestSetupDefaults.startDate ? { startDate: requestSetupDefaults.startDate } : {}),
            ...(requestSetupDefaults.weeksToEventOverride ? { weeksToEventOverride: requestSetupDefaults.weeksToEventOverride } : {}),
            ...(requestSetupDefaults.weeklyAvailabilityMinutes ? { weeklyAvailabilityMinutes: requestSetupDefaults.weeklyAvailabilityMinutes } : {}),
            ...(requestSetupDefaults.weeklyAvailabilityDays.length ? { weeklyAvailabilityDays: requestSetupDefaults.weeklyAvailabilityDays } : {}),
            ...(requestSetupDefaults.coachGuidanceText ? { coachGuidanceText: requestSetupDefaults.coachGuidanceText } : {}),
          },
        };
      });

      if (appliedCount > 0) {
        setRequestApplyMessage(`Applied ${appliedCount} request defaults to Block Setup.`);
      } else {
        setRequestApplyMessage('No changes applied. Request values already match Block Setup or are missing.');
      }

      // If an old draft exists, switch the screen back to pre-draft mode so the
      // coach sees request-driven setup only until generating a new plan.
      if (draftExists && options?.force) {
        setDraftPlanLatest(null);
        setPublishStatus(null);
        setPerformanceModel(null);
        setSessionDetailsById({});
        setSessionDraftEdits({});
        setRequestApplyMessage((prev) =>
          prev
            ? `${prev} Previous draft context cleared. Generate weekly plan to build a fresh draft from this request.`
            : 'Previous draft context cleared. Generate weekly plan to build a fresh draft from this request.'
        );
      }
    },
    [draftPlanLatest?.id, requestSetupDefaults]
  );

  const athleteTimeZone = useMemo(() => {
    const tz = (draftPlanLatest as any)?.athlete?.user?.timezone;
    if (typeof tz === 'string' && tz.trim()) return tz.trim();
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }, [draftPlanLatest]);

  useEffect(() => {
    setupSeededForAthlete.current = null;
    setSetup(buildSetupFromProfile(null));
    setAthleteProfile(null);
    setTrainingRequest(buildTrainingRequestFromProfile(null));
  }, [athleteId]);

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

      const nextDays = Array.isArray((setupJson as any)?.weeklyAvailabilityDays)
        ? stableDayList((setupJson as any).weeklyAvailabilityDays)
        : prev.weeklyAvailabilityDays;

      const nextMinutes =
        typeof (setupJson as any)?.weeklyAvailabilityMinutes === 'number'
          ? Number((setupJson as any).weeklyAvailabilityMinutes)
          : prev.weeklyAvailabilityMinutes;

      return {
        ...prev,
        weekStart,
        startDate: nextStart,
        completionDate: nextCompletion,
        weeksToEventOverride: nextOverride,
        weeklyAvailabilityDays: nextDays,
        weeklyAvailabilityMinutes: nextMinutes,
        disciplineEmphasis: (setupJson as any)?.disciplineEmphasis ?? prev.disciplineEmphasis,
        riskTolerance: (setupJson as any)?.riskTolerance ?? prev.riskTolerance,
        maxIntensityDaysPerWeek:
          typeof (setupJson as any)?.maxIntensityDaysPerWeek === 'number'
            ? Number((setupJson as any).maxIntensityDaysPerWeek)
            : prev.maxIntensityDaysPerWeek,
        maxDoublesPerWeek:
          typeof (setupJson as any)?.maxDoublesPerWeek === 'number'
            ? Number((setupJson as any).maxDoublesPerWeek)
            : prev.maxDoublesPerWeek,
        longSessionDay:
          typeof (setupJson as any)?.longSessionDay === 'number' ? Number((setupJson as any).longSessionDay) : prev.longSessionDay,
        coachGuidanceText: typeof (setupJson as any)?.coachGuidanceText === 'string' ? (setupJson as any).coachGuidanceText : prev.coachGuidanceText,
        programPolicy:
          typeof (setupJson as any)?.programPolicy === 'string'
            ? ((setupJson as any).programPolicy as SetupState['programPolicy'])
            : prev.programPolicy,
        selectedPlanSourceVersionId: Array.isArray((setupJson as any)?.selectedPlanSourceVersionIds)
          ? String((setupJson as any).selectedPlanSourceVersionIds[0] ?? '')
          : prev.selectedPlanSourceVersionId,
      };
    });
  }, [draftPlanLatest]);

  const hasDraft = Boolean(draftPlanLatest?.id);

  useEffect(() => {
    if (!athleteProfile || hasDraft) return;
    if (setupSeededForAthlete.current === athleteId) return;
    setSetup(buildSetupFromProfile(athleteProfile));
    setupSeededForAthlete.current = athleteId;
  }, [athleteId, athleteProfile, hasDraft]);

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

  const shouldPrepareReview = hasDraft && reviewReady;

  const planReasoning = useMemo(() => {
    if (!shouldPrepareReview) return null;
    const raw = (draftPlanLatest as any)?.reasoningJson;
    if (!raw || typeof raw !== 'object') return null;
    if ((raw as any)?.version !== 'v1') return null;
    return raw as PlanReasoningV1;
  }, [draftPlanLatest, shouldPrepareReview]);

  const selectedPlanSources = useMemo(() => {
    const rows = (draftPlanLatest as any)?.planSourceSelectionJson?.selectedPlanSources;
    return Array.isArray(rows) ? rows : [];
  }, [draftPlanLatest]);

  const effectiveInputPreflight = useMemo(() => {
    const raw = (draftPlanLatest as any)?.setupJson?.effectiveInputV1;
    return raw && typeof raw === 'object' ? (raw as Record<string, any>) : null;
  }, [draftPlanLatest]);


  const adaptationMemory = useMemo(() => {
    const mem = (draftPlanLatest as any)?.planSourceSelectionJson?.adaptationMemory;
    return mem && typeof mem === 'object' ? mem : null;
  }, [draftPlanLatest]);

  const adaptationSuggestions = useMemo(
    () => buildAdaptationSuggestions(adaptationMemory),
    [adaptationMemory]
  );

  const applyCoachGuidance = useCallback((guidance: string) => {
    const next = String(guidance ?? '').trim();
    if (!next) return;
    setSetup((s) => {
      const existing = String(s.coachGuidanceText ?? '').trim();
      if (!existing) return { ...s, coachGuidanceText: next };
      if (existing.includes(next)) return s;
      return { ...s, coachGuidanceText: `${existing}\n${next}` };
    });
  }, []);

  const fetchBriefLatest = useCallback(async () => {
    const data = await request<{ brief: any | null }>(
      `/api/coach/athletes/${athleteId}/athlete-brief/latest`
    );
    setBriefLatest(data.brief ?? null);
    return data.brief;
  }, [athleteId, request]);

  const fetchAthleteProfile = useCallback(async () => {
    const data = await request<{ athlete: AthleteProfileSummary }>(`/api/coach/athletes/${athleteId}`);
    setAthleteProfile(data.athlete ?? null);
    return data.athlete ?? null;
  }, [athleteId, request]);

  const fetchDraftPlanLatest = useCallback(async () => {
    const data = await request<{ draftPlan: any | null }>(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/latest`
    );
    setDraftPlanLatest(data.draftPlan);
    return data.draftPlan;
  }, [athleteId, request]);

  const fetchReferencePlans = useCallback(async () => {
    const data = await request<{ referencePlans: ReferencePlanOption[] }>(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/reference-plans`
    );
    const rows = Array.isArray(data.referencePlans) ? data.referencePlans : [];
    setReferencePlanOptions(rows);
    return rows;
  }, [athleteId, request]);

  const fetchIntakeLifecycle = useCallback(async () => {
    const data = await request<IntakeLifecycle>(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/latest`);
    const next: IntakeLifecycle = {
      latestSubmittedIntake: data.latestSubmittedIntake ?? data.intakeResponse ?? null,
      openDraftIntake: data.openDraftIntake ?? null,
      lifecycle: data.lifecycle ?? null,
    };
    setIntakeLifecycle(next);
    return next;
  }, [athleteId, request]);

  const fetchPerformanceModel = useCallback(
    async (aiPlanDraftId?: string | null) => {
      const qs = aiPlanDraftId ? `?aiPlanDraftId=${encodeURIComponent(aiPlanDraftId)}` : '';
      const data = await request<{ model: PerformanceModelPreview }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/performance-model${qs}`
      );
      setPerformanceModel(data.model ?? null);
      return data.model ?? null;
    },
    [athleteId, request]
  );

  useEffect(() => {
    const sessions = Array.isArray((draftPlanLatest as any)?.sessions) ? (draftPlanLatest as any).sessions : [];
    const valid = new Set(sessions.map((s: any) => String(s.id)));
    setSessionDetailsById((prev) => {
      const next: Record<string, { detailJson: any | null; loading: boolean; error?: string | null }> = {};
      for (const [id, state] of Object.entries(prev)) {
        if (valid.has(id)) next[id] = state;
      }
      for (const session of sessions) {
        const id = String(session.id);
        if (session.detailJson && !next[id]) {
          next[id] = { detailJson: session.detailJson, loading: false, error: null };
        }
      }
      return next;
    });
  }, [draftPlanLatest]);

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      const draftId = String((draftPlanLatest as any)?.id ?? '');
      if (!draftId) return;
      setSessionDetailsById((prev) => ({
        ...prev,
        [sessionId]: { detailJson: prev[sessionId]?.detailJson ?? null, loading: true, error: null },
      }));
      try {
        const detail = await request<{ detail: any; detailMode: string | null; detailGeneratedAt: string | null }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/session-detail?draftPlanId=${encodeURIComponent(
            draftId
          )}&sessionId=${encodeURIComponent(sessionId)}`
        );

        setSessionDetailsById((prev) => ({
          ...prev,
          [sessionId]: { detailJson: detail.detail ?? null, loading: false, error: null },
        }));

        if (detail.detail) {
          setDraftPlanLatest((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              sessions: (prev.sessions ?? []).map((s: any) => (String(s.id) === sessionId ? { ...s, detailJson: detail.detail } : s)),
            };
          });
        }
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to load details.';
        setSessionDetailsById((prev) => ({
          ...prev,
          [sessionId]: { detailJson: prev[sessionId]?.detailJson ?? null, loading: false, error: message },
        }));
      }
    },
    [athleteId, draftPlanLatest, request]
  );

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
        const [brief, draft] = await Promise.all([
          fetchBriefLatest(),
          fetchDraftPlanLatest(),
          fetchAthleteProfile(),
          fetchReferencePlans(),
          fetchIntakeLifecycle(),
        ]);

        if (cancelled) return;

        if (draft?.id) {
          await fetchPublishStatus(String(draft.id));
          await fetchPerformanceModel(String(draft.id));
        } else {
          setPublishStatus(null);
          await fetchPerformanceModel(null);
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
  }, [athleteId, fetchAthleteProfile, fetchBriefLatest, fetchDraftPlanLatest, fetchIntakeLifecycle, fetchPerformanceModel, fetchPublishStatus, fetchReferencePlans, request]);

  useEffect(() => {
    const openDraftJson = intakeLifecycle?.openDraftIntake?.draftJson;
    const submittedDraftJson = intakeLifecycle?.latestSubmittedIntake?.draftJson;
    if (openDraftJson && typeof openDraftJson === 'object') {
      setTrainingRequest(buildTrainingRequestFromDraftJson(openDraftJson));
      return;
    }
    if (submittedDraftJson && typeof submittedDraftJson === 'object') {
      setTrainingRequest(buildTrainingRequestFromDraftJson(submittedDraftJson));
      return;
    }
    setTrainingRequest(buildTrainingRequestFromProfile(athleteProfile));
  }, [athleteProfile, intakeLifecycle?.latestSubmittedIntake?.id, intakeLifecycle?.openDraftIntake?.id]);

  useEffect(() => {
    applyRequestDefaultsToSetup();
  }, [applyRequestDefaultsToSetup]);

  const openCoachTrainingRequest = useCallback(async () => {
    setBusy('open-training-request');
    setError(null);
    try {
      await request<{ intakeResponse: any }>(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, {
        method: 'POST',
        data: {
          draftJson: buildDraftJsonFromTrainingRequest(trainingRequest),
        },
      });
      await fetchIntakeLifecycle();
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to open request.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [athleteId, fetchIntakeLifecycle, request, trainingRequest]);

  const saveOpenTrainingRequest = useCallback(async () => {
    const intakeId = String(intakeLifecycle?.openDraftIntake?.id ?? '');
    if (!intakeId) return;
    setBusy('save-training-request');
    setError(null);
    try {
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, {
        method: 'PATCH',
        data: {
          intakeResponseId: intakeId,
          draftJson: buildDraftJsonFromTrainingRequest(trainingRequest),
        },
      });
      await fetchIntakeLifecycle();
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to save request.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [athleteId, fetchIntakeLifecycle, intakeLifecycle?.openDraftIntake?.id, request, trainingRequest]);

  const submitOpenTrainingRequest = useCallback(async () => {
    const intakeId = String(intakeLifecycle?.openDraftIntake?.id ?? '');
    if (!intakeId) return;
    setBusy('submit-training-request');
    setError(null);
    try {
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, {
        method: 'PATCH',
        data: {
          intakeResponseId: intakeId,
          draftJson: buildDraftJsonFromTrainingRequest(trainingRequest),
        },
      });
      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`, {
        method: 'POST',
        data: { intakeResponseId: intakeId },
      });
      await fetchIntakeLifecycle();
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to submit request.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [athleteId, fetchIntakeLifecycle, intakeLifecycle?.openDraftIntake?.id, request, trainingRequest]);

  useEffect(() => {
    if (!shouldDeferReview) return;
    if (!hasDraft || reviewReady) return;
    if (typeof window === 'undefined') return;

    const win = globalThis as any;
    let handle: ReturnType<typeof setTimeout> | number | null = null;
    if (typeof win.requestIdleCallback === 'function') {
      handle = win.requestIdleCallback(() => setReviewReady(true), { timeout: 2000 });
    } else {
      handle = globalThis.setTimeout(() => setReviewReady(true), 1200);
    }

    return () => {
      if (handle == null) return;
      if (typeof win.cancelIdleCallback === 'function' && typeof handle === 'number') {
        win.cancelIdleCallback(handle);
      } else {
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    };
  }, [hasDraft, reviewReady, shouldDeferReview]);

  useEffect(() => {
    if (!shouldDeferReview) return;
    if (reviewInView) return;
    const node = reviewSentinelRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setReviewInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReviewInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reviewInView, shouldDeferReview]);

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

  const startBuildProgress = useCallback(() => {
    const steps = ['Building weekly structure…', 'Allocating sessions…', 'Preparing session details…'];
    let idx = 0;
    setBuildProgress(steps[idx]);
    if (buildProgressTimer.current) clearInterval(buildProgressTimer.current);
    buildProgressTimer.current = setInterval(() => {
      idx = (idx + 1) % steps.length;
      setBuildProgress(steps[idx]);
    }, 1200);
  }, []);

  const stopBuildProgress = useCallback(() => {
    if (buildProgressTimer.current) {
      clearInterval(buildProgressTimer.current);
      buildProgressTimer.current = null;
    }
    setBuildProgress(null);
  }, []);

  const generatePlanPreview = useCallback(async () => {
    setBusy('generate-plan');
    setError(null);
    startBuildProgress();
    try {
      const startDate = isDayKey(setup.startDate) ? setup.startDate : null;
      const completionDate = isDayKey(setup.completionDate) ? setup.completionDate : null;
      if (!startDate) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Starting date is required.');
      }
      if (!completionDate) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Completion date is required.');
      }
      if (!Array.isArray(setup.weeklyAvailabilityDays) || setup.weeklyAvailabilityDays.length === 0) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Select at least one available day.');
      }
      if (!Number.isFinite(Number(setup.weeklyAvailabilityMinutes)) || Number(setup.weeklyAvailabilityMinutes) <= 0) {
        throw new ApiClientError(400, 'VALIDATION_ERROR', 'Weekly time budget must be greater than zero.');
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
        programPolicy: setup.programPolicy || undefined,
        selectedPlanSourceVersionIds: setup.selectedPlanSourceVersionId ? [setup.selectedPlanSourceVersionId] : undefined,
      };

      const created = await request<{ draftPlan: any }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
        { method: 'POST', data: { setup: payload } }
      );

      setDraftPlanLatest(created.draftPlan ?? null);
      if (created.draftPlan?.id) {
        await fetchPublishStatus(String(created.draftPlan.id));
        await fetchPerformanceModel(String(created.draftPlan.id));
      } else {
        setPublishStatus(null);
        setPerformanceModel(null);
      }
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to generate plan.';
      setError(message);
    } finally {
      setBusy(null);
      stopBuildProgress();
    }
  }, [athleteId, effectiveWeeksToCompletion, fetchPerformanceModel, fetchPublishStatus, request, setup, startBuildProgress, stopBuildProgress]);

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

  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
    setCommandPaletteQuery('');
    setCommandPaletteActiveIndex(0);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    setCommandPaletteActiveIndex(0);
  }, []);

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

  const setAllWeekLocks = useCallback(
    async (locked: boolean) => {
      const draftId = String(draftPlanLatest?.id ?? '');
      if (!draftId) return;
      const weeks = Array.isArray(draftPlanLatest?.weeks) ? draftPlanLatest.weeks : [];
      const weekLocks = weeks
        .map((w: any) => Number(w?.weekIndex))
        .filter((idx: number) => Number.isInteger(idx) && idx >= 0)
        .map((weekIndex: number) => ({ weekIndex, locked }));
      if (!weekLocks.length) return;

      setBusy(locked ? 'lock-all-weeks' : 'unlock-all-weeks');
      setError(null);
      try {
        const updated = await request<{ draftPlan: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
          {
            method: 'PATCH',
            data: {
              draftPlanId: draftId,
              weekLocks,
            },
          }
        );
        setDraftPlanLatest(updated.draftPlan ?? null);
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to update week locks.';
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [athleteId, draftPlanLatest, request]
  );

  const setAllSessionLocks = useCallback(
    async (locked: boolean) => {
      const draftId = String(draftPlanLatest?.id ?? '');
      if (!draftId) return;
      const sessions = Array.isArray(draftPlanLatest?.sessions) ? draftPlanLatest.sessions : [];
      const sessionEdits = sessions
        .map((s: any) => String(s?.id ?? ''))
        .filter((id: string) => id.length > 0)
        .map((sessionId: string) => ({ sessionId, locked }));
      if (!sessionEdits.length) return;

      setBusy(locked ? 'lock-all-sessions' : 'unlock-all-sessions');
      setError(null);
      try {
        const updated = await request<{ draftPlan: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
          {
            method: 'PATCH',
            data: {
              draftPlanId: draftId,
              sessionEdits,
            },
          }
        );
        setDraftPlanLatest(updated.draftPlan ?? null);
      } catch (e) {
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to update session locks.';
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [athleteId, draftPlanLatest, request]
  );

  const canStart = !briefLatest;
  const canPlan = Boolean(briefLatest);
  const isPublished = publishStatus?.visibilityStatus === 'PUBLISHED';

  const commandActions = useMemo<CommandAction[]>(
    () => [
      {
        id: 'refresh-page',
        label: 'Refresh screen',
        keywords: 'reload refresh page',
        disabled: busy != null,
        run: () => window.location.reload(),
      },
      {
        id: 'refresh-brief',
        label: canStart ? 'Create athlete snapshot' : 'Refresh athlete snapshot',
        keywords: 'athlete brief snapshot intake',
        disabled: busy != null,
        run: () => {
          void refreshBrief();
        },
      },
      {
        id: 'generate-plan',
        label: 'Generate weekly plan',
        keywords: 'build preview draft plan',
        disabled: busy != null || !canPlan,
        run: () => {
          void generatePlanPreview();
        },
      },
      {
        id: 'publish',
        label: 'Approve and schedule',
        keywords: 'publish schedule calendar',
        disabled: busy != null || !hasDraft,
        run: () => {
          void publishPlan();
        },
      },
      {
        id: 'toggle-advanced',
        label: showAdvancedSetup ? 'Hide advanced setup' : 'Show advanced setup',
        keywords: 'advanced setup',
        disabled: false,
        run: () => setShowAdvancedSetup((v) => !v),
      },
      {
        id: 'toggle-compare',
        label: reviewSideMode === 'reference' ? 'Switch compare to earlier vs recent' : 'Switch compare to reference plans',
        keywords: 'compare reference previous',
        disabled: !hasDraft,
        run: () => setReviewSideMode((m) => (m === 'reference' ? 'previous' : 'reference')),
      },
      {
        id: 'open-calendar',
        label: 'Open scheduling calendar',
        keywords: 'calendar schedule coach',
        disabled: false,
        run: () => router.push('/coach/calendar'),
      },
      {
        id: 'apply-readiness-guidance',
        label: 'Apply top readiness guidance',
        keywords: 'readiness adaptation recovery pain adherence',
        disabled: adaptationSuggestions.length === 0,
        run: () => {
          const top = adaptationSuggestions[0];
          if (top) applyCoachGuidance(top.guidance);
        },
      },
      {
        id: 'lock-all-weeks',
        label: 'Lock all weeks',
        keywords: 'bulk lock weeks review',
        disabled: !hasDraft || busy != null,
        run: () => {
          void setAllWeekLocks(true);
        },
      },
      {
        id: 'unlock-all-weeks',
        label: 'Unlock all weeks',
        keywords: 'bulk unlock weeks review',
        disabled: !hasDraft || busy != null,
        run: () => {
          void setAllWeekLocks(false);
        },
      },
      {
        id: 'lock-all-sessions',
        label: 'Lock all sessions',
        keywords: 'bulk lock sessions review',
        disabled: !hasDraft || busy != null,
        run: () => {
          void setAllSessionLocks(true);
        },
      },
      {
        id: 'unlock-all-sessions',
        label: 'Unlock all sessions',
        keywords: 'bulk unlock sessions review',
        disabled: !hasDraft || busy != null,
        run: () => {
          void setAllSessionLocks(false);
        },
      },
    ],
    [
      adaptationSuggestions,
      applyCoachGuidance,
      busy,
      canPlan,
      canStart,
      generatePlanPreview,
      hasDraft,
      publishPlan,
      refreshBrief,
      reviewSideMode,
      router,
      setAllSessionLocks,
      setAllWeekLocks,
      showAdvancedSetup,
    ]
  );

  const filteredCommandActions = useMemo(() => {
    const q = commandPaletteQuery.trim().toLowerCase();
    if (!q) return commandActions;
    return commandActions.filter((action) => `${action.label} ${action.keywords}`.toLowerCase().includes(q));
  }, [commandActions, commandPaletteQuery]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    setCommandPaletteActiveIndex(0);
  }, [commandPaletteOpen, commandPaletteQuery]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    const node = commandPaletteInputRef.current;
    if (!node) return;
    const id = window.setTimeout(() => node.focus(), 0);
    return () => window.clearTimeout(id);
  }, [commandPaletteOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!commandPaletteOpen && isShortcut) {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (!commandPaletteOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!filteredCommandActions.length) return;
        setCommandPaletteActiveIndex((idx) => (idx + 1) % filteredCommandActions.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!filteredCommandActions.length) return;
        setCommandPaletteActiveIndex((idx) => (idx - 1 + filteredCommandActions.length) % filteredCommandActions.length);
        return;
      }

      if (event.key === 'Enter') {
        const action = filteredCommandActions[commandPaletteActiveIndex];
        if (!action || action.disabled) return;
        event.preventDefault();
        closeCommandPalette();
        action.run();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    closeCommandPalette,
    commandPaletteActiveIndex,
    commandPaletteOpen,
    filteredCommandActions,
    openCommandPalette,
  ]);

  const sessionsByWeek = useMemo(() => {
    if (!shouldPrepareReview) return [];
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
  }, [draftPlanLatest?.sessions, effectiveWeekStart, shouldPrepareReview]);

  const weekStatsByIndex = useMemo(() => {
    const map = new Map<number, WeekStats>();
    for (const [weekIndex, sessions] of sessionsByWeek) {
      const totalMinutes = sessions.reduce((sum, s) => sum + Number(s?.durationMinutes ?? 0), 0);
      const intensity = sessions.filter((s) => {
        const t = String(s?.type ?? '').toLowerCase();
        return t === 'tempo' || t === 'threshold';
      }).length;
      map.set(weekIndex, { sessions: sessions.length, totalMinutes, intensity });
    }
    return map;
  }, [sessionsByWeek]);

  const compareWeekOptions = useMemo(
    () =>
      sessionsByWeek.map(([weekIndex]) => ({
        weekIndex,
        label: `Week ${weekIndex + 1}`,
      })),
    [sessionsByWeek]
  );

  useEffect(() => {
    if (!compareWeekOptions.length) {
      setSelectedCompareWeekIndex(null);
      return;
    }
    if (selectedCompareWeekIndex == null || !weekStatsByIndex.has(selectedCompareWeekIndex)) {
      setSelectedCompareWeekIndex(compareWeekOptions[0].weekIndex);
    }
  }, [compareWeekOptions, selectedCompareWeekIndex, weekStatsByIndex]);

  const previousBlockSummary = useMemo(() => {
    const weeks = sessionsByWeek.map(([weekIndex]) => weekStatsByIndex.get(weekIndex)).filter(Boolean) as WeekStats[];
    if (!weeks.length) return null;
    const firstBlock = weeks.slice(0, Math.min(4, weeks.length));
    const lastBlock = weeks.slice(Math.max(0, weeks.length - Math.min(4, weeks.length)));
    const blockStats = (rows: WeekStats[]) => {
      return rows.reduce(
        (acc, row) => ({
          sessions: acc.sessions + row.sessions,
          totalMinutes: acc.totalMinutes + row.totalMinutes,
          intensity: acc.intensity + row.intensity,
        }),
        { sessions: 0, totalMinutes: 0, intensity: 0 }
      );
    };
    return {
      early: blockStats(firstBlock),
      recent: blockStats(lastBlock),
      earlyRange: `Weeks 1-${firstBlock.length}`,
      recentRange: `Weeks ${Math.max(1, weeks.length - lastBlock.length + 1)}-${weeks.length}`,
    };
  }, [sessionsByWeek, weekStatsByIndex]);

  const selectedWeekStats = useMemo(() => {
    if (selectedCompareWeekIndex == null) return null;
    return weekStatsByIndex.get(selectedCompareWeekIndex) ?? null;
  }, [selectedCompareWeekIndex, weekStatsByIndex]);

  const previousWeekStats = useMemo(() => {
    if (selectedCompareWeekIndex == null) return null;
    return weekStatsByIndex.get(selectedCompareWeekIndex - 1) ?? null;
  }, [selectedCompareWeekIndex, weekStatsByIndex]);

  const selectedReasoningWeek = useMemo(() => {
    if (!planReasoning || selectedCompareWeekIndex == null) return null;
    return (
      planReasoning.weeks.find((w) => Number(w.weekIndex) === selectedCompareWeekIndex) ??
      planReasoning.weeks[0] ??
      null
    );
  }, [planReasoning, selectedCompareWeekIndex]);

  const sessionsByWeekMap = useMemo(() => new Map(sessionsByWeek), [sessionsByWeek]);

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
          <h2 className="text-lg font-semibold">Build This Athlete&apos;s Next Training Block</h2>
          <div className="text-sm text-[var(--fg-muted)]">
            Set the block, generate a weekly plan, then approve and schedule.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy != null}
            data-testid="apb-open-command-palette"
            onClick={openCommandPalette}
          >
            Quick actions
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy != null} onClick={() => window.location.reload()}>
            Refresh
          </Button>
          <a href="/coach/calendar" className="text-sm text-[var(--fg)] underline">
            Open scheduling calendar
          </a>
        </div>
      </div>
      <div className="mt-2 text-xs text-[var(--fg-muted)]">Tip: press Cmd/Ctrl+K for quick actions.</div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="mt-6 space-y-4">
        <Block title="1) Training Request">
          <div className="space-y-3 text-sm">
            <div className="text-[var(--fg-muted)]">
              Coach completes this request with event-specific inputs. One open request at a time.
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-structure)] px-3 py-2">
              <div>
                Open request:{' '}
                <span className="font-medium">
                  {intakeLifecycle?.openDraftIntake ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="text-xs text-[var(--fg-muted)]">
                Latest submitted:{' '}
                {intakeLifecycle?.latestSubmittedIntake?.submittedAt
                  ? new Date(String(intakeLifecycle.latestSubmittedIntake.submittedAt)).toLocaleString()
                  : 'None'}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Primary goal for this block</div>
                <Input
                  value={trainingRequest.goalDetails}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, goalDetails: e.target.value }))}
                  placeholder="e.g. Build to complete Olympic triathlon"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Goal focus</div>
                <Input
                  value={trainingRequest.goalFocus}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, goalFocus: e.target.value }))}
                  placeholder="e.g. Improve run durability"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Event name</div>
                <Input
                  value={trainingRequest.eventName}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, eventName: e.target.value }))}
                  placeholder="e.g. Noosa Triathlon"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Event date</div>
                <Input
                  type="date"
                  value={trainingRequest.eventDate}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, eventDate: e.target.value }))}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Target timeline</div>
                <Select
                  value={trainingRequest.goalTimeline}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, goalTimeline: e.target.value }))}
                >
                  <option value="">Select timeline</option>
                  {GOAL_TIMELINE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Weekly time budget (minutes)</div>
                <Input
                  inputMode="numeric"
                  value={trainingRequest.weeklyMinutes}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, weeklyMinutes: e.target.value }))}
                  placeholder="e.g. 360"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Experience level</div>
                <Select
                  value={trainingRequest.experienceLevel}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, experienceLevel: e.target.value }))}
                >
                  <option value="">Select level</option>
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Available days</div>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_SHORTS.map((day) => {
                    const selected = trainingRequest.availabilityDays.includes(day);
                    return (
                      <Button
                        key={day}
                        type="button"
                        size="sm"
                        variant={selected ? 'primary' : 'secondary'}
                        onClick={() =>
                          setTrainingRequest((s) => ({
                            ...s,
                            availabilityDays: selected ? s.availabilityDays.filter((d) => d !== day) : [...s.availabilityDays, day],
                          }))
                        }
                      >
                        {day}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Current injury or pain status</div>
                <Textarea
                  value={trainingRequest.injuryStatus}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, injuryStatus: e.target.value }))}
                  rows={3}
                  placeholder="e.g. Mild Achilles soreness after hard runs"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--fg-muted)]">Other constraints and coach notes</div>
                <Textarea
                  value={trainingRequest.constraintsNotes}
                  onChange={(e) => setTrainingRequest((s) => ({ ...s, constraintsNotes: e.target.value }))}
                  rows={3}
                  placeholder="e.g. Travel Tue-Thu next fortnight"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                disabled={busy != null || Boolean(intakeLifecycle?.openDraftIntake)}
                onClick={openCoachTrainingRequest}
                data-testid="apb-open-training-request"
              >
                {busy === 'open-training-request' ? 'Opening…' : 'Open training request'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy != null || !intakeLifecycle?.openDraftIntake}
                onClick={saveOpenTrainingRequest}
                data-testid="apb-save-training-request"
              >
                {busy === 'save-training-request' ? 'Saving…' : 'Save request draft'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy != null}
                onClick={() => applyRequestDefaultsToSetup({ force: true })}
                data-testid="apb-apply-request-to-setup"
              >
                Apply request to block setup
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy != null || !intakeLifecycle?.openDraftIntake}
                onClick={submitOpenTrainingRequest}
                data-testid="apb-submit-training-request"
              >
                {busy === 'submit-training-request' ? 'Submitting…' : 'Mark request complete'}
              </Button>
            </div>
            {hasDraft ? (
              <div className="text-xs text-[var(--fg-muted)]">
                Existing draft detected. Use "Apply request to block setup" to overwrite setup defaults from this request.
              </div>
            ) : null}
            {requestApplyMessage ? <div className="text-xs text-emerald-700">{requestApplyMessage}</div> : null}
          </div>
        </Block>

        <Block title="Athlete Snapshot">
          {!briefLatest ? (
            <div className="text-sm text-[var(--fg-muted)]">No snapshot yet. Ask the athlete to complete intake.</div>
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

        <Block title="2) Confirm Athlete Snapshot">
          <div className="space-y-3">
            <div className="text-sm text-[var(--fg-muted)]">
              Pull the latest intake and profile information before building this block.
            </div>
            <Button
              type="button"
              variant="primary"
              disabled={busy != null}
              data-testid="apb-refresh-brief"
              onClick={refreshBrief}
            >
              {busy === 'refresh-brief' ? 'Refreshing…' : canStart ? 'Create snapshot' : 'Refresh snapshot'}
            </Button>

            {!canPlan ? (
              <div className="text-sm text-[var(--fg-muted)]">Athlete snapshot required to continue.</div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3" data-testid="apb-athlete-brief">
                <div className="text-sm font-semibold">Athlete snapshot</div>
                <div className="mt-2 text-sm text-[var(--fg-muted)]">Ready to build this training block.</div>
              </div>
            )}
          </div>
        </Block>

        <Block
          title="3) Block Setup"
          rightAction={
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy != null || !canPlan}
              data-testid="apb-generate-plan"
              onClick={generatePlanPreview}
            >
              {busy === 'generate-plan' ? 'Generating…' : 'Generate weekly plan'}
            </Button>
          }
        >
          <div className="mb-3 text-xs text-[var(--fg-muted)]">
            Defaults come from the athlete profile. Changes here apply only to this block.
          </div>
          {(setupSourceLabels.completionDate ||
            setupSourceLabels.weeksToEventOverride ||
            setupSourceLabels.weeklyAvailabilityMinutes ||
            setupSourceLabels.weeklyAvailabilityDays ||
            setupSourceLabels.coachGuidanceText) && (
            <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Training Request defaults have been applied to block setup values.
            </div>
          )}
          {effectiveInputPreflight?.preflight?.hasConflicts ? (
            <div
              className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-structure)] px-3 py-3 text-xs text-[var(--fg)]"
              data-testid="apb-effective-input-conflicts"
            >
              <div className="font-semibold">
                Input source reconciliation ({Number(effectiveInputPreflight?.preflight?.conflictCount ?? 0)} fields)
              </div>
              <div className="mt-1">
                Priority used: approved profile overrides, then submitted request, then athlete profile.
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {(Array.isArray(effectiveInputPreflight?.conflicts) ? effectiveInputPreflight.conflicts : [])
                  .slice(0, 4)
                  .map((item: any, idx: number) => (
                    <li key={`conflict-${idx}`}>
                      {String(item?.field ?? 'field')} resolved from {String(item?.chosenSource ?? 'source')}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-structure)] px-3 py-3">
            <div className="mb-2 text-sm font-semibold">Plan Type</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
              <Select
                value={setup.programPolicy}
                onChange={(e) => setSetup((s) => ({ ...s, programPolicy: e.target.value as SetupState['programPolicy'] }))}
                data-testid="apb-program-policy"
              >
                <option value="">Custom block (no template)</option>
                <option value="COUCH_TO_5K">Couch to 5K</option>
                <option value="COUCH_TO_IRONMAN_26">Couch to Ironman (26w)</option>
                <option value="HALF_TO_FULL_MARATHON">Half Marathon to Marathon</option>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSetup((s) => applyPolicyPreset(s, derivedWeeksToCompletion))}
                disabled={!setup.programPolicy}
                data-testid="apb-apply-policy-preset"
              >
                Use suggested setup
              </Button>
            </div>
            <div className="mt-2 text-xs text-[var(--fg-muted)]">
              Templates apply recommended progression and structure. You can still edit every field.
            </div>
          </div>
          <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-structure)] px-3 py-3">
            <div className="mb-2 text-sm font-semibold">Reference Plan from Library</div>
            <Select
              value={setup.selectedPlanSourceVersionId}
              onChange={(e) => setSetup((s) => ({ ...s, selectedPlanSourceVersionId: e.target.value }))}
              data-testid="apb-reference-plan-select"
            >
              <option value="">Auto-select best match</option>
              {referencePlanOptions.map((plan) => {
                const rec = plan.recommended ? 'Recommended' : '';
                const score = typeof plan.score === 'number' ? `score ${plan.score.toFixed(2)}` : '';
                const meta = [plan.sport, plan.distance, `${plan.durationWeeks}w`, plan.level, rec || score].filter(Boolean).join(' • ');
                return (
                  <option key={plan.planSourceVersionId} value={plan.planSourceVersionId}>
                    {plan.title} ({meta})
                  </option>
                );
              })}
            </Select>
            <div className="mt-2 text-xs text-[var(--fg-muted)]">
              Select a known plan to anchor generation, or leave on auto for blended retrieval.
            </div>
          </div>
          {adaptationMemory ? (
            <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-3" data-testid="apb-readiness-card">
              <div className="text-sm font-semibold">Current Training Status</div>
              <div className="mt-1 text-xs text-[var(--fg-muted)]">
                Completion {(Number(adaptationMemory.completionRate ?? 0) * 100).toFixed(0)}% · Skips {(Number(adaptationMemory.skipRate ?? 0) * 100).toFixed(0)}% ·
                Soreness {(Number(adaptationMemory.sorenessRate ?? 0) * 100).toFixed(0)}% · Pain {(Number(adaptationMemory.painRate ?? 0) * 100).toFixed(0)}%
                {adaptationMemory.avgRpe != null ? ` · Avg RPE ${adaptationMemory.avgRpe}` : ''}
              </div>
              {Array.isArray(adaptationMemory.notes) && adaptationMemory.notes.length ? (
                <div className="mt-2 text-xs text-[var(--text)]">{adaptationMemory.notes[0]}</div>
              ) : null}
              <div className="mt-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                <div className="text-xs font-medium text-[var(--text)]">Recommended coach prompts</div>
                <div className="mt-2 space-y-2">
                  {adaptationSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="rounded border border-[var(--border-subtle)] bg-[var(--bg)] p-2"
                      data-testid={`apb-adaptation-suggestion-${suggestion.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium text-[var(--text)]">{suggestion.label}</div>
                          <div className="mt-1 text-xs text-[var(--fg-muted)]">{suggestion.guidance}</div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => applyCoachGuidance(suggestion.guidance)}
                        >
                          Use
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {Array.isArray(adaptationMemory.notes) && adaptationMemory.notes[0] ? (
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => applyCoachGuidance(adaptationMemory.notes[0])}>
                    Use recorded coach note
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {performanceModel ? (
            <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-3" data-testid="apb-load-impact-card">
              <div className="text-sm font-semibold">Load Impact Preview (CTL / ATL / TSB)</div>
              <div className="mt-2 grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                  <div className="font-medium">Current</div>
                  <div className="mt-1 text-[var(--fg-muted)]">
                    CTL {performanceModel.current.ctl} · ATL {performanceModel.current.atl} · TSB {performanceModel.current.tsb}
                  </div>
                </div>
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                  <div className="font-medium">Projected</div>
                  <div className="mt-1 text-[var(--fg-muted)]">
                    CTL {performanceModel.projected.ctl} · ATL {performanceModel.projected.atl} · TSB {performanceModel.projected.tsb}
                  </div>
                </div>
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                  <div className="font-medium">Delta</div>
                  <div className="mt-1 text-[var(--fg-muted)]">
                    CTL {performanceModel.delta.ctl >= 0 ? '+' : ''}
                    {performanceModel.delta.ctl} · ATL {performanceModel.delta.atl >= 0 ? '+' : ''}
                    {performanceModel.delta.atl} · TSB {performanceModel.delta.tsb >= 0 ? '+' : ''}
                    {performanceModel.delta.tsb}
                  </div>
                  <div className="mt-1 text-[var(--fg-muted)]">
                    {performanceModel.upcoming.days}d planned load {performanceModel.upcoming.plannedLoad} (avg {performanceModel.upcoming.avgDailyLoad}/day)
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {buildProgress ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-structure)] px-3 py-2 text-sm" data-testid="apb-build-progress">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--fg-muted)] border-t-transparent" />
              <span className="text-[var(--text)]">{buildProgress}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <span>Coach priorities for this block (optional)</span>
                {setupSourceLabels.coachGuidanceText ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    {setupSourceLabels.coachGuidanceText}
                  </span>
                ) : null}
              </div>
              <Textarea
                rows={3}
                value={setup.coachGuidanceText}
                onChange={(e) => setSetup((s) => ({ ...s, coachGuidanceText: e.target.value }))}
                placeholder="Example: Keep long run on Sunday, no hard sessions the day after, focus on consistency first."
                data-testid="apb-coach-guidance"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Block start date</div>
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
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <span>Block end date</span>
                {setupSourceLabels.completionDate ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    {setupSourceLabels.completionDate}
                  </span>
                ) : null}
              </div>
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
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>Block length (weeks)</span>
                  {setupSourceLabels.weeksToEventOverride ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                      {setupSourceLabels.weeksToEventOverride}
                    </span>
                  ) : null}
                </div>
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
                  {setup.weeksToEventOverride == null ? 'Auto from dates' : 'Set manually'}
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
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <span>Weekly training time (minutes)</span>
                {setupSourceLabels.weeklyAvailabilityMinutes ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    {setupSourceLabels.weeklyAvailabilityMinutes}
                  </span>
                ) : null}
              </div>
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
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <span>Available days</span>
                {setupSourceLabels.weeklyAvailabilityDays ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    {setupSourceLabels.weeklyAvailabilityDays}
                  </span>
                ) : null}
              </div>
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
              <div className="mb-1 text-sm font-medium">Primary discipline focus</div>
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
              <div className="mb-1 text-sm font-medium">Progression approach</div>
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

            <div className="md:col-span-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setShowAdvancedSetup((v) => !v)}
                data-testid="apb-toggle-advanced-setup"
              >
                {showAdvancedSetup ? 'Hide advanced setup' : 'Show advanced setup'}
              </Button>
            </div>

            {showAdvancedSetup ? (
              <>
                <div>
                  <div className="mb-1 text-sm font-medium">Hard sessions per week (max)</div>
                  <Input
                    type="number"
                    min={0}
                    max={7}
                    value={String(setup.maxIntensityDaysPerWeek)}
                    onChange={(e) =>
                      setSetup((s) => ({
                        ...s,
                        maxIntensityDaysPerWeek: Math.max(0, Math.min(7, Number(e.target.value) || 0)),
                      }))
                    }
                    data-testid="apb-max-intensity-days"
                  />
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium">Double-session days per week (max)</div>
                  <Input
                    type="number"
                    min={0}
                    max={7}
                    value={String(setup.maxDoublesPerWeek)}
                    onChange={(e) =>
                      setSetup((s) => ({
                        ...s,
                        maxDoublesPerWeek: Math.max(0, Math.min(7, Number(e.target.value) || 0)),
                      }))
                    }
                    data-testid="apb-max-doubles"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-sm font-medium">Preferred long session day</div>
                  <Select
                    value={setup.longSessionDay == null ? '' : String(setup.longSessionDay)}
                    onChange={(e) =>
                      setSetup((s) => ({
                        ...s,
                        longSessionDay: e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
                      }))
                    }
                    data-testid="apb-long-session-day"
                  >
                    <option value="">No preference</option>
                    {orderedDays.map((day) => (
                      <option key={day} value={day}>
                        {DAY_NAMES_SUN0[day]}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            ) : null}
          </div>
        </Block>

        <Block
          title="3) Preview & Edit Weekly Plan"
          rightAction={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy != null || !hasDraft}
                onClick={() => void setAllWeekLocks(true)}
                data-testid="apb-lock-all-weeks"
              >
                Lock all weeks
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy != null || !hasDraft}
                onClick={() => void setAllSessionLocks(true)}
                data-testid="apb-lock-all-sessions"
              >
                Lock all sessions
              </Button>
            </div>
          }
        >
          <div ref={reviewSentinelRef} className="h-px w-full" aria-hidden="true" />
          {!hasDraft ? (
            <div className="text-sm text-[var(--fg-muted)]">Generate a weekly plan to preview and edit sessions.</div>
          ) : reviewReady && reviewInView ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
              <ReviewPlanSection
                hasDraft={hasDraft}
                planReasoning={planReasoning}
                sessionsByWeek={sessionsByWeek}
                sessionsByWeekMap={sessionsByWeekMap}
                sessionDraftEdits={sessionDraftEdits}
                weekLockedByIndex={weekLockedByIndex}
                setup={{ startDate: setup.startDate, completionDate: setup.completionDate }}
                effectiveWeekStart={effectiveWeekStart}
                effectiveWeeksToCompletion={effectiveWeeksToCompletion}
                busy={busy}
                setSessionDraftEdits={setSessionDraftEdits}
                saveSessionEdit={saveSessionEdit}
                toggleSessionLock={toggleSessionLock}
                toggleWeekLock={toggleWeekLock}
                sessionDetailsById={sessionDetailsById}
                loadSessionDetail={loadSessionDetail}
              />
              <aside className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3" data-testid="apb-reference-pane">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Compare Views</div>
                  <Select value={reviewSideMode} onChange={(e) => setReviewSideMode(e.target.value as any)}>
                    <option value="reference">Reference plans</option>
                    <option value="previous">Earlier vs recent block</option>
                  </Select>
                </div>
                <div className="mt-1 text-xs text-[var(--fg-muted)]">
                  {reviewSideMode === 'reference'
                    ? 'Compare this draft week against plan reasoning targets and matched sources.'
                    : 'Compare this draft week against the previous week to check progression drift.'}
                </div>
                {compareWeekOptions.length ? (
                  <div className="mt-3">
                    <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Compare week</div>
                    <Select
                      value={selectedCompareWeekIndex == null ? '' : String(selectedCompareWeekIndex)}
                      onChange={(e) => setSelectedCompareWeekIndex(Number.parseInt(e.target.value, 10))}
                      data-testid="apb-compare-week-select"
                    >
                      {compareWeekOptions.map((opt) => (
                        <option key={opt.weekIndex} value={opt.weekIndex}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
                {selectedWeekStats ? (
                  <div className="mt-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2 text-xs" data-testid="apb-compare-current-week">
                    <div className="font-medium">
                      Draft {selectedCompareWeekIndex != null ? `Week ${selectedCompareWeekIndex + 1}` : 'week'}
                    </div>
                    <div className="text-[var(--fg-muted)]">
                      {selectedWeekStats.sessions} sessions · {selectedWeekStats.totalMinutes} min · {selectedWeekStats.intensity} key sessions
                    </div>
                  </div>
                ) : null}
                {reviewSideMode === 'reference' && selectedPlanSources.length ? (
                  <div className="mt-3 space-y-2 text-xs">
                    {selectedReasoningWeek ? (
                      <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2" data-testid="apb-compare-reference-target">
                        <div className="font-medium">Reference target ({`Week ${Number(selectedReasoningWeek.weekIndex) + 1}`})</div>
                        <div className="text-[var(--fg-muted)]">
                          {selectedReasoningWeek.volumeMinutesPlanned} min · {selectedReasoningWeek.intensityDaysPlanned} key days · {selectedReasoningWeek.weekIntent}
                        </div>
                        {selectedWeekStats ? (
                          <div className="mt-1 text-[var(--fg-muted)]">
                            Delta {selectedWeekStats.totalMinutes - Number(selectedReasoningWeek.volumeMinutesPlanned)} min
                            {' · '}
                            {selectedWeekStats.intensity - Number(selectedReasoningWeek.intensityDaysPlanned)} key days
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <ul className="space-y-2">
                      {selectedPlanSources.slice(0, 3).map((src: any) => (
                        <li key={String(src.planSourceVersionId)} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                          <div className="font-medium text-[var(--text)]">{String(src.title ?? 'Plan source')}</div>
                          <div className="text-[var(--fg-muted)]">
                            Score {Number(src.score ?? 0).toFixed(2)}
                            {src.semanticScore != null ? ` · Semantic ${Number(src.semanticScore).toFixed(2)}` : ''}
                            {src.metadataScore != null ? ` · Metadata ${Number(src.metadataScore).toFixed(2)}` : ''}
                          </div>
                          {Array.isArray(src.reasons) && src.reasons.length ? (
                            <div className="mt-1 text-[var(--fg-muted)]">{src.reasons.slice(0, 2).join(' · ')}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : reviewSideMode === 'reference' ? (
                  <div className="mt-3 text-xs text-[var(--fg-muted)]">No reference sources attached yet for this draft.</div>
                ) : selectedWeekStats && previousWeekStats ? (
                  <div className="mt-3 space-y-2 text-xs" data-testid="apb-compare-previous-week">
                    <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                      <div className="font-medium">
                        Week {selectedCompareWeekIndex != null ? selectedCompareWeekIndex : 0}
                      </div>
                      <div className="text-[var(--fg-muted)]">
                        {previousWeekStats.sessions} sessions · {previousWeekStats.totalMinutes} min · {previousWeekStats.intensity} key sessions
                      </div>
                    </div>
                    <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                      <div className="font-medium">
                        Drift into Week {selectedCompareWeekIndex != null ? selectedCompareWeekIndex + 1 : 1}
                      </div>
                      <div className="text-[var(--fg-muted)]">
                        {selectedWeekStats.totalMinutes - previousWeekStats.totalMinutes >= 0 ? '+' : ''}
                        {selectedWeekStats.totalMinutes - previousWeekStats.totalMinutes}
                        {' min · '}
                        {selectedWeekStats.intensity - previousWeekStats.intensity >= 0 ? '+' : ''}
                        {selectedWeekStats.intensity - previousWeekStats.intensity}
                        {' key sessions'}
                      </div>
                    </div>
                  </div>
                ) : previousBlockSummary ? (
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                      <div className="font-medium">{previousBlockSummary.earlyRange}</div>
                      <div className="text-[var(--fg-muted)]">
                        {previousBlockSummary.early.sessions} sessions · {previousBlockSummary.early.totalMinutes} min · {previousBlockSummary.early.intensity} key sessions
                      </div>
                    </div>
                    <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                      <div className="font-medium">{previousBlockSummary.recentRange}</div>
                      <div className="text-[var(--fg-muted)]">
                        {previousBlockSummary.recent.sessions} sessions · {previousBlockSummary.recent.totalMinutes} min · {previousBlockSummary.recent.intensity} key sessions
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-[var(--fg-muted)]">Not enough week data to compare blocks yet.</div>
                )}
              </aside>
            </div>
          ) : (
            <div className="min-h-[120px] text-sm text-[var(--fg-muted)]">Preparing review details...</div>
          )}
        </Block>

        <Block
          title="4) Approve & Schedule"
          rightAction={
            <Button
              type="button"
              size="sm"
              disabled={busy != null || !hasDraft}
              data-testid="apb-publish"
              onClick={publishPlan}
            >
              {busy === 'publish' ? 'Scheduling…' : 'Approve and schedule'}
            </Button>
          }
        >
          {!hasDraft ? (
            <div className="text-sm text-[var(--fg-muted)]">Generate a plan before scheduling to the athlete calendar.</div>
          ) : isPublished ? (
            <div className="space-y-2">
              <div
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3 text-sm"
                data-testid="apb-publish-success"
              >
                Scheduled successfully. Sessions are now visible in the athlete calendar.
              </div>
              <a href="/coach/calendar" className="text-sm text-[var(--fg)] underline" data-testid="apb-open-calendar">
                Open coach calendar
              </a>
            </div>
          ) : (
            <div className="text-sm text-[var(--fg-muted)]">This schedules all plan weeks onto the athlete calendar.</div>
          )}
        </Block>
      </div>

      {commandPaletteOpen ? (
        <>
          <div className="fixed inset-0 z-[70] bg-black/35" onClick={closeCommandPalette} />
          <div
            className="fixed left-1/2 top-20 z-[71] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-label="Quick actions"
            data-testid="apb-command-palette"
          >
            <Input
              ref={commandPaletteInputRef}
              value={commandPaletteQuery}
              onChange={(e) => setCommandPaletteQuery(e.target.value)}
              placeholder="Search actions…"
              data-testid="apb-command-palette-input"
            />
            <div className="mt-2 max-h-80 overflow-y-auto">
              {filteredCommandActions.length === 0 ? (
                <div className="rounded-md px-3 py-2 text-sm text-[var(--fg-muted)]">No actions found.</div>
              ) : (
                <div className="space-y-1">
                  {filteredCommandActions.map((action, idx) => {
                    const isActive = idx === commandPaletteActiveIndex;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                          isActive
                            ? 'border-[var(--border)] bg-[var(--bg-structure)]'
                            : 'border-transparent bg-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--bg-structure)]'
                        } ${action.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                        disabled={action.disabled}
                        onMouseEnter={() => setCommandPaletteActiveIndex(idx)}
                        onClick={() => {
                          closeCommandPalette();
                          action.run();
                        }}
                        data-testid={`apb-command-action-${action.id}`}
                      >
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="mt-2 text-xs text-[var(--fg-muted)]">Navigate with ↑ ↓, press Enter to run, Esc to close.</div>
          </div>
        </>
      ) : null}
    </div>
  );
}
