'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ApiClientError, useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { uiH1, uiMuted } from '@/components/ui/typography';
import { cn } from '@/lib/cn';

type TrainingRequestForm = {
  goalDetails: string;
  goalFocus: string;
  primaryDisciplineFocus: '' | 'balanced' | 'swim' | 'bike' | 'run';
  blockStartDate: string;
  eventName: string;
  eventDate: string;
  weeklyMinutes: string;
  availabilityDays: DayShort[];
  nonNegotiableDays: DayShort[];
  preferredKeyDays: DayShort[];
  dailyTimeWindows: Partial<Record<DayShort, TimeWindow[]>>;
  experienceLevel: string;
  injuryStatus: string;
  disciplineInjuryNotes: string;
  equipment: '' | 'mixed' | 'trainer' | 'road' | 'treadmill' | 'pool' | 'gym';
  environmentTags: string[];
  fatigueState: '' | 'fresh' | 'normal' | 'fatigued' | 'cooked';
  availableTimeMinutes: string;
  constraintsNotes: string; // Coach-only: preserved but not editable by athlete.
};

type IntakeLifecycle = {
  latestSubmittedIntake?: { id: string; draftJson?: unknown; createdAt?: string | null } | null;
  openDraftIntake?: { id: string; draftJson?: unknown; createdAt?: string | null } | null;
  lifecycle?: { hasOpenRequest?: boolean; canOpenNewRequest?: boolean } | null;
};

type AthleteProfileResponse = {
  athlete: {
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
};

const DAY_SHORTS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_SHORTS_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
type DayShort = (typeof DAY_SHORTS)[number];

const DAY_NAME_TO_SHORT: Record<string, DayShort> = {
  Sunday: 'Sun',
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
};

const EQUIPMENT_OPTIONS = [
  { value: '', label: 'Select equipment preferences' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'trainer', label: 'Bike trainer' },
  { value: 'road', label: 'Road/outdoor bike' },
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'pool', label: 'Pool access' },
  { value: 'gym', label: 'Gym access' },
] as const;

const EXPERIENCE_LEVEL_OPTIONS = [
  { value: '', label: 'Select experience level' },
  { value: 'Beginner', label: 'Beginner' },
  { value: 'Some experience', label: 'Some experience' },
  { value: 'Intermediate', label: 'Intermediate' },
  { value: 'Advanced', label: 'Advanced' },
  { value: 'Competitive', label: 'Competitive' },
] as const;

const FATIGUE_OPTIONS = [
  { value: '', label: 'Select readiness' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'normal', label: 'Normal' },
  { value: 'fatigued', label: 'Fatigued' },
  { value: 'cooked', label: 'Cooked' },
] as const;

type TimeWindow = 'any' | 'am' | 'midday' | 'pm' | 'evening';
const TIME_WINDOW_OPTIONS: Array<{ value: TimeWindow; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: 'am', label: 'AM' },
  { value: 'midday', label: 'Midday' },
  { value: 'pm', label: 'PM' },
  { value: 'evening', label: 'Evening' },
];

function dayShortsFromProfileDays(days: string[] | null | undefined): DayShort[] {
  if (!Array.isArray(days)) return [];
  const normalized = days
    .map((d) => {
      const trimmed = String(d ?? '').trim();
      if (!trimmed) return null;
      return DAY_NAME_TO_SHORT[trimmed] ?? (DAY_SHORTS.includes(trimmed as DayShort) ? (trimmed as DayShort) : null);
    })
    .filter((d): d is DayShort => d != null);
  return Array.from(new Set(normalized));
}

function deriveDisciplineEmphasis(disciplines: string[] | null | undefined): TrainingRequestForm['primaryDisciplineFocus'] {
  const normalized = Array.isArray(disciplines)
    ? Array.from(new Set(disciplines.map((d) => String(d ?? '').trim().toUpperCase()).filter(Boolean)))
    : [];
  if (normalized.length <= 1) {
    const only = normalized[0];
    if (only === 'SWIM') return 'swim';
    if (only === 'BIKE') return 'bike';
    if (only === 'RUN') return 'run';
  }
  return normalized.length ? 'balanced' : '';
}

function buildTrainingRequestFromProfile(profile: AthleteProfileResponse['athlete'] | null): TrainingRequestForm {
  return {
    goalDetails: String(profile?.primaryGoal ?? ''),
    goalFocus: String(profile?.focus ?? ''),
    primaryDisciplineFocus: deriveDisciplineEmphasis(profile?.disciplines ?? null),
    blockStartDate: '',
    eventName: String(profile?.eventName ?? ''),
    eventDate: typeof profile?.eventDate === 'string' ? profile.eventDate.slice(0, 10) : '',
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

function normalizeDayShortList(value: unknown): DayShort[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((d) => String(d ?? '').trim())
        .filter((d) => DAY_SHORTS.includes(d as DayShort) || Object.keys(DAY_NAME_TO_SHORT).includes(d))
        .map((d) => (DAY_SHORTS.includes(d as DayShort) ? (d as DayShort) : DAY_NAME_TO_SHORT[d]))
    )
  );
}

function buildTrainingRequestFromDraftJson(raw: unknown): TrainingRequestForm {
  const map = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const availabilityDays = normalizeDayShortList(map.availability_days);
  const nonNegotiableDays = normalizeDayShortList(map.non_negotiable_days);
  const preferredKeyDays = normalizeDayShortList(map.preferred_key_days);

  const source = map.daily_time_windows && typeof map.daily_time_windows === 'object' ? (map.daily_time_windows as Record<string, unknown>) : {};
  const dailyTimeWindows: Partial<Record<DayShort, TimeWindow[]>> = {};
  for (const day of DAY_SHORTS) {
    const rawValue = source[day];
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
      .map((v) => String(v ?? '').toLowerCase().trim())
      .filter((v): v is TimeWindow => v === 'any' || v === 'am' || v === 'midday' || v === 'pm' || v === 'evening');
    if (values.length > 0) {
      const unique = Array.from(new Set(values));
      dailyTimeWindows[day] = unique.includes('any') ? ['any'] : unique;
    }
  }

  const equipmentValue = String(map.equipment ?? '').toLowerCase();
  const fatigueValue = String(map.fatigue_state ?? '').toLowerCase();

  return {
    goalDetails: String(map.goal_details ?? ''),
    goalFocus: String(map.goal_focus ?? ''),
    primaryDisciplineFocus:
      map.primary_discipline_focus === 'balanced' ||
      map.primary_discipline_focus === 'swim' ||
      map.primary_discipline_focus === 'bike' ||
      map.primary_discipline_focus === 'run'
        ? (map.primary_discipline_focus as TrainingRequestForm['primaryDisciplineFocus'])
        : '',
    blockStartDate: String(map.block_start_date ?? ''),
    eventName: String(map.event_name ?? ''),
    eventDate: String(map.event_date ?? ''),
    weeklyMinutes: map.weekly_minutes != null ? String(map.weekly_minutes) : '',
    availabilityDays,
    nonNegotiableDays,
    preferredKeyDays,
    dailyTimeWindows,
    experienceLevel: String(map.experience_level ?? ''),
    injuryStatus: String(map.injury_status ?? ''),
    disciplineInjuryNotes: String(map.discipline_injury_notes ?? ''),
    equipment:
      equipmentValue === 'mixed' ||
      equipmentValue === 'trainer' ||
      equipmentValue === 'road' ||
      equipmentValue === 'treadmill' ||
      equipmentValue === 'pool' ||
      equipmentValue === 'gym'
        ? (equipmentValue as TrainingRequestForm['equipment'])
        : '',
    environmentTags: [],
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
    block_start_date: form.blockStartDate || null,
    event_name: form.eventName.trim() || null,
    event_date: form.eventDate || null,
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
    // Coach-only field: preserved from existing draft/profile but not editable on athlete UI.
    constraints_notes: form.constraintsNotes.trim() || null,
  };
}

function toggleDay(list: DayShort[], day: DayShort): DayShort[] {
  const has = list.includes(day);
  const next = has ? list.filter((d) => d !== day) : [...list, day];
  const order = new Map(DAY_SHORTS_MON_FIRST.map((d, i) => [d, i]));
  return Array.from(new Set(next)).sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

function formatApiErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message || 'Request failed.';
  return err instanceof Error ? err.message : 'Request failed.';
}

export default function AthleteTrainingRequestPage() {
  const { request } = useApi();
  const { user, loading: userLoading } = useAuthUser();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'open' | 'save' | 'submit' | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [requestStatus, setRequestStatus] = useState<'none' | 'draft' | 'submitted'>('none');
  const [intakeResponseId, setIntakeResponseId] = useState<string | null>(null);
  const [trainingRequest, setTrainingRequest] = useState<TrainingRequestForm>(() => buildTrainingRequestFromProfile(null));
  const [openTimeWindowDay, setOpenTimeWindowDay] = useState<DayShort | null>(null);

  const hasOpenRequest = requestStatus === 'draft' && Boolean(intakeResponseId);

  const requestStatusTitle =
    requestStatus === 'draft'
      ? 'Step 1 in progress: request draft open'
      : requestStatus === 'submitted'
        ? 'Step 1 complete: request submitted'
        : 'Step 1 not started';

  const requestStatusBody =
    requestStatus === 'draft'
      ? 'You are editing this request. Next: submit when details are ready.'
      : requestStatus === 'submitted'
        ? 'Request submitted. Your coach can now generate the next block from this request.'
        : 'Open a training request to start this process.';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [intake, profileRes] = await Promise.all([
        request<IntakeLifecycle>('/api/athlete/ai-plan/intake/latest', { cache: 'no-store' }),
        request<AthleteProfileResponse>('/api/athlete/profile', { cache: 'no-store' }),
      ]);

      const profileDefaults = buildTrainingRequestFromProfile(profileRes?.athlete ?? null);
      if (intake?.openDraftIntake?.id) {
        setRequestStatus('draft');
        setIntakeResponseId(intake.openDraftIntake.id);
        const merged = {
          ...profileDefaults,
          ...buildTrainingRequestFromDraftJson(intake.openDraftIntake.draftJson),
          constraintsNotes: buildTrainingRequestFromDraftJson(intake.openDraftIntake.draftJson).constraintsNotes || profileDefaults.constraintsNotes,
        };
        setTrainingRequest(merged);
      } else if (intake?.latestSubmittedIntake?.id) {
        setRequestStatus('submitted');
        setIntakeResponseId(intake.latestSubmittedIntake.id);
        const merged = {
          ...profileDefaults,
          ...buildTrainingRequestFromDraftJson(intake.latestSubmittedIntake.draftJson),
          constraintsNotes: buildTrainingRequestFromDraftJson(intake.latestSubmittedIntake.draftJson).constraintsNotes || profileDefaults.constraintsNotes,
        };
        setTrainingRequest(merged);
      } else {
        setRequestStatus('none');
        setIntakeResponseId(null);
        setTrainingRequest(profileDefaults);
      }
    } catch (e) {
      setError(formatApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (user?.role === 'ATHLETE') void load();
  }, [load, user?.role]);

  useEffect(() => {
    setTrainingRequest((prev) => {
      const allowed = new Set(prev.availabilityDays);
      const nextDaily: Partial<Record<DayShort, TimeWindow[]>> = {};
      for (const day of DAY_SHORTS) {
        if (allowed.has(day) && prev.dailyTimeWindows[day]?.length) {
          nextDaily[day] = prev.dailyTimeWindows[day];
        }
      }
      return { ...prev, dailyTimeWindows: nextDaily };
    });
  }, [trainingRequest.availabilityDays]);

  const openTrainingRequest = useCallback(async () => {
    setBusy('open');
    setError('');
    setInfo('');
    try {
      const data = await request<{ intakeResponse: { id: string; draftJson?: unknown } }>(
        '/api/athlete/ai-plan/training-request/draft',
        {
          method: 'POST',
          data: { draftJson: buildDraftJsonFromTrainingRequest(trainingRequest) },
        }
      );
      setRequestStatus('draft');
      setIntakeResponseId(data.intakeResponse.id);
      setInfo('Training request opened.');
    } catch (e) {
      setError(formatApiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [request, trainingRequest]);

  const saveTrainingRequest = useCallback(async () => {
    if (!intakeResponseId) return;
    setBusy('save');
    setError('');
    setInfo('');
    try {
      await request('/api/athlete/ai-plan/training-request/draft', {
        method: 'PATCH',
        data: { intakeResponseId, draftJson: buildDraftJsonFromTrainingRequest(trainingRequest) },
      });
      setInfo('Training request draft saved.');
    } catch (e) {
      setError(formatApiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [intakeResponseId, request, trainingRequest]);

  const submitTrainingRequest = useCallback(async () => {
    if (!intakeResponseId) return;
    setBusy('submit');
    setError('');
    setInfo('');
    try {
      await request('/api/athlete/ai-plan/training-request/draft', {
        method: 'PATCH',
        data: { intakeResponseId, draftJson: buildDraftJsonFromTrainingRequest(trainingRequest) },
      });
      await request('/api/athlete/ai-plan/training-request/submit', {
        method: 'POST',
        data: { intakeResponseId },
      });
      setRequestStatus('submitted');
      setInfo('Training request submitted.');
      await load();
    } catch (e) {
      setError(formatApiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [intakeResponseId, load, request, trainingRequest]);

  const dayWindowOptions = useMemo(
    () => (trainingRequest.availabilityDays.length ? trainingRequest.availabilityDays : DAY_SHORTS_MON_FIRST),
    [trainingRequest.availabilityDays]
  );
  const experienceValueOptions = useMemo(() => {
    const current = trainingRequest.experienceLevel.trim();
    if (!current) return EXPERIENCE_LEVEL_OPTIONS;
    if (EXPERIENCE_LEVEL_OPTIONS.some((opt) => opt.value === current)) return EXPERIENCE_LEVEL_OPTIONS;
    return [...EXPERIENCE_LEVEL_OPTIONS, { value: current, label: current }] as const;
  }, [trainingRequest.experienceLevel]);

  const toggleTimeWindowValue = useCallback((day: DayShort, value: TimeWindow) => {
    setTrainingRequest((prev) => {
      const current: TimeWindow[] = prev.dailyTimeWindows[day]?.length ? prev.dailyTimeWindows[day]! : ['any'];
      let next: TimeWindow[];
      if (value === 'any') {
        next = ['any'];
      } else if (current.includes(value)) {
        const stripped: TimeWindow[] = current.filter((v) => v !== value && v !== 'any');
        next = stripped.length ? stripped : ['any'];
      } else {
        next = Array.from(new Set([...current.filter((v) => v !== 'any'), value])) as TimeWindow[];
      }

      return {
        ...prev,
        dailyTimeWindows: {
          ...prev.dailyTimeWindows,
          [day]: next,
        },
      };
    });
  }, []);

  const dayWindowLabel = useCallback((day: DayShort) => {
    const selected = trainingRequest.dailyTimeWindows[day] ?? ['any'];
    const normalized = selected.includes('any') ? ['any'] : selected;
    if (normalized.length === 1 && normalized[0] === 'any') return 'Any time';
    const labels = TIME_WINDOW_OPTIONS.filter((opt) => normalized.includes(opt.value)).map((opt) => opt.label);
    return labels.join(', ');
  }, [trainingRequest.dailyTimeWindows]);

  if (userLoading || loading) {
    return (
      <div className="px-6 pt-6">
        <p className={uiMuted}>Loading…</p>
      </div>
    );
  }

  if (!user || user.role !== 'ATHLETE') {
    return (
      <div className="px-6 pt-6">
        <p className={uiMuted}>Athlete access required.</p>
      </div>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 md:px-6">
      <header className="space-y-1">
        <h1 className={uiH1}>Training Request</h1>
        <p className={uiMuted}>Complete this with your event and availability details so your coach can build your next block.</p>
      </header>

      {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {info ? <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</div> : null}

      <Block title="1) TRAINING REQUEST">
        <div className="mb-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-sm">
          Capture or update your block request. Your coach and you are editing the same request draft.
        </div>
        <div className="mb-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm">
          <div className="font-medium">{requestStatusTitle}</div>
          <div>{requestStatusBody}</div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">
            Primary goal
            <Input value={trainingRequest.goalDetails} onChange={(e) => setTrainingRequest((p) => ({ ...p, goalDetails: e.target.value }))} disabled={!hasOpenRequest} />
          </label>
          <label className="text-sm font-medium">
            Goal focus
            <Input value={trainingRequest.goalFocus} onChange={(e) => setTrainingRequest((p) => ({ ...p, goalFocus: e.target.value }))} disabled={!hasOpenRequest} />
          </label>

          <label className="text-sm font-medium">
            Primary discipline focus
            <Select
              value={trainingRequest.primaryDisciplineFocus}
              onChange={(e) =>
                setTrainingRequest((p) => ({ ...p, primaryDisciplineFocus: (e.target.value || '') as TrainingRequestForm['primaryDisciplineFocus'] }))
              }
              disabled={!hasOpenRequest}
            >
              <option value="">Select focus</option>
              <option value="balanced">Balanced</option>
              <option value="swim">Swim</option>
              <option value="bike">Bike</option>
              <option value="run">Run</option>
            </Select>
          </label>
          <label className="text-sm font-medium">
            Block start date
            <Input type="date" value={trainingRequest.blockStartDate} onChange={(e) => setTrainingRequest((p) => ({ ...p, blockStartDate: e.target.value }))} disabled={!hasOpenRequest} />
          </label>

          <label className="text-sm font-medium">
            Event name
            <Input value={trainingRequest.eventName} onChange={(e) => setTrainingRequest((p) => ({ ...p, eventName: e.target.value }))} disabled={!hasOpenRequest} />
          </label>
          <label className="text-sm font-medium">
            Event date
            <Input type="date" value={trainingRequest.eventDate} onChange={(e) => setTrainingRequest((p) => ({ ...p, eventDate: e.target.value }))} disabled={!hasOpenRequest} />
          </label>

          <label className="text-sm font-medium md:col-span-1">
            Weekly time budget (minutes)
            <Input value={trainingRequest.weeklyMinutes} onChange={(e) => setTrainingRequest((p) => ({ ...p, weeklyMinutes: e.target.value }))} inputMode="numeric" disabled={!hasOpenRequest} />
          </label>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-sm font-medium">Available days</div>
          <div className="flex flex-wrap gap-2">
            {DAY_SHORTS_MON_FIRST.map((day) => {
              const active = trainingRequest.availabilityDays.includes(day);
              return (
                <button
                  key={`avail:${day}`}
                  type="button"
                  disabled={!hasOpenRequest}
                  onClick={() => setTrainingRequest((prev) => ({ ...prev, availabilityDays: toggleDay(prev.availabilityDays, day) }))}
                  className={cn('rounded-md border px-3 py-1 text-sm', active ? 'border-blue-600 bg-blue-600 text-white' : 'border-[var(--border-subtle)] bg-white')}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-sm font-medium">Non-negotiable off days</div>
          <div className="flex flex-wrap gap-2">
            {DAY_SHORTS_MON_FIRST.map((day) => {
              const active = trainingRequest.nonNegotiableDays.includes(day);
              return (
                <button
                  key={`off:${day}`}
                  type="button"
                  disabled={!hasOpenRequest}
                  onClick={() => setTrainingRequest((prev) => ({ ...prev, nonNegotiableDays: toggleDay(prev.nonNegotiableDays, day) }))}
                  className={cn('rounded-md border px-3 py-1 text-sm', active ? 'border-rose-600 bg-rose-500 text-white' : 'border-[var(--border-subtle)] bg-white')}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-sm font-medium">Preferred key-session days</div>
          <div className="flex flex-wrap gap-2">
            {DAY_SHORTS_MON_FIRST.map((day) => {
              const active = trainingRequest.preferredKeyDays.includes(day);
              return (
                <button
                  key={`key:${day}`}
                  type="button"
                  disabled={!hasOpenRequest}
                  onClick={() => setTrainingRequest((prev) => ({ ...prev, preferredKeyDays: toggleDay(prev.preferredKeyDays, day) }))}
                  className={cn('rounded-md border px-3 py-1 text-sm', active ? 'border-blue-600 bg-blue-600 text-white' : 'border-[var(--border-subtle)] bg-white')}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-sm font-medium">Daily time windows (optional)</div>
          <p className="mb-2 text-xs text-[var(--muted)]">Choose one or more windows for each selected available day.</p>
          <div className="grid gap-2 md:grid-cols-4">
            {dayWindowOptions.map((day) => (
              <div key={`window:${day}`} className="relative text-xs font-medium">
                <div>{day}</div>
                <button
                  type="button"
                  disabled={!hasOpenRequest}
                  onClick={() => setOpenTimeWindowDay((prev) => (prev === day ? null : day))}
                  className="mt-1 flex min-h-[44px] w-full items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-left text-sm font-normal"
                >
                  <span className="truncate">{dayWindowLabel(day)}</span>
                  <span className="ml-2 text-[var(--muted)]">⌄</span>
                </button>

                {openTimeWindowDay === day && hasOpenRequest ? (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 shadow-lg">
                    <div className="space-y-1">
                      {TIME_WINDOW_OPTIONS.map((opt) => {
                        const selected = (trainingRequest.dailyTimeWindows[day] ?? ['any']).includes(opt.value);
                        return (
                          <label key={`${day}:${opt.value}`} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--bg-surface)]">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleTimeWindowValue(day, opt.value)}
                            />
                            <span>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">
            Experience level
            <Select
              value={trainingRequest.experienceLevel}
              onChange={(e) => setTrainingRequest((p) => ({ ...p, experienceLevel: e.target.value }))}
              disabled={!hasOpenRequest}
            >
              {experienceValueOptions.map((opt) => (
                <option key={opt.value || 'empty'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm font-medium">
            Current injury/pain status
            <Input value={trainingRequest.injuryStatus} onChange={(e) => setTrainingRequest((p) => ({ ...p, injuryStatus: e.target.value }))} disabled={!hasOpenRequest} />
          </label>
          <label className="text-sm font-medium">
            Discipline-specific injury limits
            <Input
              placeholder="e.g. No downhill run reps while shin settles"
              value={trainingRequest.disciplineInjuryNotes}
              onChange={(e) => setTrainingRequest((p) => ({ ...p, disciplineInjuryNotes: e.target.value }))}
              disabled={!hasOpenRequest}
            />
          </label>
          <label className="text-sm font-medium">
            Typical single-session time available (minutes)
            <Input
              inputMode="numeric"
              placeholder="e.g. 60"
              value={trainingRequest.availableTimeMinutes}
              onChange={(e) => setTrainingRequest((p) => ({ ...p, availableTimeMinutes: e.target.value }))}
              disabled={!hasOpenRequest}
            />
          </label>
          <label className="text-sm font-medium">
            Equipment Preferences
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
          </label>
          <label className="text-sm font-medium">
            Current readiness / fatigue
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
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void openTrainingRequest()} disabled={busy != null}>
            {busy === 'open' ? 'Opening…' : 'Edit training reeust'}
          </Button>
          <Button variant="secondary" onClick={() => void saveTrainingRequest()} disabled={busy != null || !hasOpenRequest}>
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </Button>
          <Button variant="secondary" onClick={() => void submitTrainingRequest()} disabled={busy != null || !hasOpenRequest}>
            {busy === 'submit' ? 'Submitting…' : 'Submit request'}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/athlete/dashboard')}>
            Back to dashboard
          </Button>
        </div>
      </Block>
    </section>
  );
}
