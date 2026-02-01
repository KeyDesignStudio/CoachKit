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
    return 'AI is temporarily rate limited — using a fallback.';
  }
  if (e.code === 'CONFIG_MISSING') {
    return 'AI is not configured — using a fallback.';
  }
  return 'Something went wrong.';
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

  const [sessionDraftEdits, setSessionDraftEdits] = useState<Record<string, { durationMinutes?: string; notes?: string }>>(
    {}
  );

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

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">AI Plan Builder</div>
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
                  Generate a coach-friendly athlete summary.
                </div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy != null}
                  data-testid="apb-generate-intake-ai"
                  onClick={startWithAi}
                >
                  {busy === 'generate-intake' ? 'Generating…' : 'Generate athlete info (AI)'}
                </Button>
              </>
            ) : (
              <div className="text-sm text-[var(--fg-muted)]">Athlete info is ready.</div>
            )}

            {!canPlan ? (
              <div className="text-sm text-[var(--fg-muted)]">Generate athlete info to continue.</div>
            ) : profileLatest?.extractedSummaryText ? (
              <div className="whitespace-pre-wrap text-sm" data-testid="apb-athlete-summary">
                {String(profileLatest.extractedSummaryText)}
              </div>
            ) : (
              <div className="text-sm text-[var(--fg-muted)]">Building athlete summary…</div>
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
                  </div>

                  <div className="space-y-3">
                    {sessions.map((s) => {
                      const detailParsed = sessionDetailV1Schema.safeParse((s as any)?.detailJson ?? null);
                      const objective = detailParsed.success ? detailParsed.data.objective : null;
                      const blocks = detailParsed.success ? detailParsed.data.structure : [];

                      const sessionId = String(s.id);
                      const edit = sessionDraftEdits[sessionId] ?? {};

                      return (
                        <div key={sessionId} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg)] px-3 py-3" data-testid="apb-session">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium">
                              {DAY_NAMES_SUN0[Number(s.dayOfWeek) ?? 0]} — {String(s.discipline ?? '').toUpperCase()} · {String(s.type ?? '')}
                            </div>
                          </div>

                          {objective ? (
                            <div className="mt-2 text-sm" data-testid="apb-session-objective">
                              {objective}
                            </div>
                          ) : (
                            <div className="mt-2 text-sm text-[var(--fg-muted)]">Session detail is loading…</div>
                          )}

                          {blocks.length ? (
                            <div className="mt-2 space-y-2" data-testid="apb-session-detail-blocks">
                              {blocks.slice(0, 3).map((b, idx) => (
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

                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busy != null}
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
