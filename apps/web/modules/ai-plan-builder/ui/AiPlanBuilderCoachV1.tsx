/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

import { ApiClientError, useApi } from '@/components/api-client';

import { DAY_NAMES_SUN0, daySortKey, normalizeWeekStart, orderedDayIndices } from '../lib/week-start';
import { sessionDetailV1Schema } from '../rules/session-detail';

type SetupState = {
  weekStart: 'monday' | 'sunday';
  eventDate: string;
  weeksToEvent: number;
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

function toSingleSentence(input: unknown): string | null {
  const raw = typeof input === 'string' ? input : input == null ? '' : String(input);
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const m = s.match(/^(.+?[.!?])\s+/);
  const first = m?.[1] ? m[1].trim() : s;
  if (!first) return null;
  if (/[.!?]$/.test(first)) return first;
  return `${first}.`;
}

function stripKeyPrefix(input: unknown): string | null {
  const raw = typeof input === 'string' ? input : input == null ? '' : String(input);
  const s = raw.trim();
  if (!s) return null;
  return s.replace(/^\s*[a-zA-Z_]+\s*:\s*/, '').trim() || null;
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

export function AiPlanBuilderCoachV1({ athleteId }: { athleteId: string }) {
  const { request } = useApi();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [intakeLatest, setIntakeLatest] = useState<any | null>(null);
  const [profileLatest, setProfileLatest] = useState<any | null>(null);
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
    eventDate: new Date().toISOString().slice(0, 10),
    weeksToEvent: 12,
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

  const fetchIntakeLatest = useCallback(async () => {
    const data = await request<{ intakeResponse: any | null }>(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/latest`
    );
    setIntakeLatest(data.intakeResponse);
    return data.intakeResponse;
  }, [athleteId, request]);

  const fetchProfileLatest = useCallback(async () => {
    const data = await request<{ profile: any | null }>(
      `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/latest`
    );
    setProfileLatest(data.profile);
    return data.profile;
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
        const [intake, profile, draft] = await Promise.all([fetchIntakeLatest(), fetchProfileLatest(), fetchDraftPlanLatest()]);

        if (cancelled) return;

        if (draft?.id) {
          await fetchPublishStatus(String(draft.id));
        } else {
          setPublishStatus(null);
        }

        // If there is an intake but no AI summary yet, build it automatically.
        if (intake?.id && !profile?.id) {
          try {
            const extracted = await request<{ profile: any | null }>(
              `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`,
              {
                method: 'POST',
                data: { intakeResponseId: String(intake.id) },
              }
            );
            setProfileLatest(extracted.profile ?? null);
          } catch {
            // Non-blocking: the coach can still generate a plan using fallback summary.
          }
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to load.';
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [athleteId, fetchDraftPlanLatest, fetchIntakeLatest, fetchProfileLatest, fetchPublishStatus, request]);

  const startWithAi = useCallback(async () => {
    setBusy('generate-intake');
    setError(null);
    try {
      const data = await request<{ intakeResponse: any; profile?: any | null }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/generate`,
        { method: 'POST', data: {} }
      );

      setIntakeLatest(data.intakeResponse ?? null);
      if (data.profile !== undefined) {
        setProfileLatest(data.profile);
      } else {
        await fetchProfileLatest();
      }
    } catch (e) {
      const message = e instanceof ApiClientError ? formatApiErrorMessage(e) : e instanceof Error ? e.message : 'Failed to start.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [athleteId, fetchProfileLatest, request]);

  const generatePlanPreview = useCallback(async () => {
    setBusy('generate-plan');
    setError(null);
    try {
      const payload = {
        ...setup,
        weeklyAvailabilityDays: stableDayList(setup.weeklyAvailabilityDays),
        weeklyAvailabilityMinutes: Number(setup.weeklyAvailabilityMinutes) || 0,
        weeksToEvent: Number(setup.weeksToEvent) || 1,
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
  }, [athleteId, fetchPublishStatus, request, setup]);

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

  const canStart = !intakeLatest;
  const canPlan = Boolean(intakeLatest?.id);
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
        <Block title="1) Athlete Info">
          <div className="space-y-3">
            {canStart ? (
              <>
                <div className="text-sm text-[var(--fg-muted)]">
                  Build an athlete brief for planning.
                </div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy != null}
                  data-testid="apb-generate-intake-ai"
                  onClick={startWithAi}
                >
                  {busy === 'generate-intake' ? 'Preparing…' : 'Generate athlete info'}
                </Button>
              </>
            ) : (
              <div className="text-sm text-[var(--fg-muted)]">Athlete info is ready.</div>
            )}

            {!canPlan ? (
              <div className="text-sm text-[var(--fg-muted)]">Generate athlete info to continue.</div>
            ) : (
              (() => {
                const raw =
                  (profileLatest as any)?.coachOverridesJson ??
                  (profileLatest as any)?.extractedProfileJson ??
                  (intakeLatest as any)?.draftJson ??
                  null;

                const primaryGoal = toSingleSentence((raw as any)?.primary_goal ?? (raw as any)?.primaryGoal ?? null);
                const disciplines = Array.isArray((raw as any)?.disciplines)
                  ? (raw as any).disciplines.map(humanizeDiscipline).filter(Boolean)
                  : [];

                const frequency = humanizeTrainingFrequency((raw as any)?.training_plan_frequency ?? (raw as any)?.trainingPlanFrequency);
                const preferredDay = humanizeDayOfWeek((raw as any)?.training_plan_day_of_week ?? (raw as any)?.trainingPlanDayOfWeek);
                const weekOfMonth = humanizeWeekOfMonth((raw as any)?.training_plan_week_of_month ?? (raw as any)?.trainingPlanWeekOfMonth);
                const coachNotes = stripKeyPrefix((raw as any)?.coach_notes ?? (raw as any)?.coachNotes ?? null);

                const hasAny = Boolean(primaryGoal || disciplines.length || frequency || preferredDay || weekOfMonth || coachNotes);

                if (!hasAny) {
                  return <div className="text-sm text-[var(--fg-muted)]">Preparing athlete brief…</div>;
                }

                return (
                  <div
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3"
                    data-testid="apb-athlete-brief"
                  >
                    <div className="text-sm font-semibold">Athlete Brief</div>

                    <div className="mt-3 space-y-3 text-sm">
                      {primaryGoal ? (
                        <div>
                          <div className="font-medium">Goal</div>
                          <div className="text-[var(--fg)]">{primaryGoal}</div>
                        </div>
                      ) : null}

                      {disciplines.length ? (
                        <div>
                          <div className="font-medium">Disciplines</div>
                          <div className="text-[var(--fg)]">{disciplines.join(', ')}</div>
                        </div>
                      ) : null}

                      {frequency || preferredDay || weekOfMonth ? (
                        <div>
                          <div className="font-medium">Training rhythm</div>
                          <div className="space-y-1 text-[var(--fg)]">
                            {frequency ? <div>Frequency: {frequency}</div> : null}
                            {preferredDay ? <div>Preferred day: {preferredDay}</div> : null}
                            {weekOfMonth ? <div>Week of month: {weekOfMonth}</div> : null}
                          </div>
                        </div>
                      ) : null}

                      {coachNotes ? (
                        <div>
                          <div className="font-medium">Coach notes</div>
                          <div className="text-[var(--fg)]">{coachNotes}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })()
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
              <div className="mb-1 text-sm font-medium">Event date</div>
              <Input
                type="date"
                value={setup.eventDate}
                onChange={(e) => setSetup((s) => ({ ...s, eventDate: e.target.value }))}
                data-testid="apb-event-date"
              />
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Weeks to event</div>
              <Input
                type="number"
                min={1}
                max={52}
                value={String(setup.weeksToEvent)}
                onChange={(e) => setSetup((s) => ({ ...s, weeksToEvent: Number(e.target.value) }))}
                data-testid="apb-weeks-to-event"
              />
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
              {sessionsByWeek.map(([weekIndex, sessions]) => (
                <div key={weekIndex} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3" data-testid="apb-week">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold">Week {Number(weekIndex) + 1}</div>
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

                  <div className="space-y-3">
                    {sessions.map((s) => {
                      const detailParsed = sessionDetailV1Schema.safeParse((s as any)?.detailJson ?? null);
                      const objective = detailParsed.success ? detailParsed.data.objective : null;
                      const blocks = detailParsed.success ? detailParsed.data.structure : [];

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
                        <div key={sessionId} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg)] px-3 py-3" data-testid="apb-session">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium">
                              {DAY_NAMES_SUN0[Number(s.dayOfWeek) ?? 0]}
                              {locked ? (
                                <span className="ml-2 rounded bg-[var(--bg-structure)] px-2 py-0.5 text-xs text-[var(--fg-muted)]">Locked</span>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
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

                              <Input
                                value={edit.type ?? String((s as any)?.type ?? '')}
                                disabled={busy != null || locked}
                                data-testid="apb-session-type"
                                onChange={(e) =>
                                  setSessionDraftEdits((m) => ({
                                    ...m,
                                    [sessionId]: { ...(m[sessionId] ?? {}), type: e.target.value },
                                  }))
                                }
                                placeholder="Type"
                              />

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

                          {weekLocked ? (
                            <div className="mt-2 text-xs text-[var(--fg-muted)]">Week is locked — unlock the week to edit sessions.</div>
                          ) : sessionLocked ? (
                            <div className="mt-2 text-xs text-[var(--fg-muted)]">Session is locked — unlock the session to edit details.</div>
                          ) : null}

                          {objective ? (
                            <div className="mt-2 text-sm" data-testid="apb-session-objective">
                              {objective}
                            </div>
                          ) : (
                            <div className="mt-2 text-sm text-[var(--fg-muted)]">Session detail is loading…</div>
                          )}

                          {blocks.length ? (
                            <div className="mt-2 space-y-2" data-testid="apb-session-detail-blocks">
                              {blocks.map((b, idx) => (
                                <div key={idx} className="text-xs text-[var(--fg-muted)]" data-testid="apb-session-detail-block">
                                  <span className="font-medium">{String(b.blockType).toUpperCase()}</span>
                                  {b.durationMinutes ? ` · ${b.durationMinutes} min` : ''} — {String(b.steps)}
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Duration (min)</div>
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
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Coach notes</div>
                              <Textarea
                                rows={2}
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
                          </div>

                          <div className="mt-3">
                            <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">Objective (editable)</div>
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

                          <div className="mt-2 flex items-center gap-2">
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
