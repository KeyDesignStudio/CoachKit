/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

import { ApiClientError, useApi } from '@/components/api-client';

export function AiPlanBuilderPage({ athleteId }: { athleteId: string }) {
  const { request } = useApi();

  const [tab, setTab] = useState<'intake' | 'plan'>('intake');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [intakeLatest, setIntakeLatest] = useState<any | null>(null);
  const [intakeEvidence, setIntakeEvidence] = useState<any[] | null>(null);
  const [profileLatest, setProfileLatest] = useState<any | null>(null);
  const [draftPlanLatest, setDraftPlanLatest] = useState<any | null>(null);
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});

  const [profileOverrideJson, setProfileOverrideJson] = useState<string>('{}');

  const [setup, setSetup] = useState({
    eventDate: new Date().toISOString().slice(0, 10),
    weeksToEvent: 12,
    weeklyAvailabilityDays: [1, 2, 3, 5, 6],
    weeklyAvailabilityMinutes: 360,
    disciplineEmphasis: 'balanced' as 'balanced' | 'swim' | 'bike' | 'run',
    riskTolerance: 'med' as 'low' | 'med' | 'high',
    maxIntensityDaysPerWeek: 2,
    maxDoublesPerWeek: 1,
    longSessionDay: 6 as number | null,
  });

  const dayNames = useMemo(() => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], []);

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

  const fetchEvidence = useCallback(
    async (intakeResponseId: string) => {
      const data = await request<{ evidence: any[] }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/${intakeResponseId}/evidence`
      );
      setIntakeEvidence(data.evidence);
      return data.evidence;
    },
    [athleteId, request]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const intake = await fetchIntakeLatest();
        if (!cancelled && intake?.id) {
          await fetchEvidence(String(intake.id));
        } else if (!cancelled) {
          setIntakeEvidence(null);
        }
        await fetchProfileLatest();
        await fetchDraftPlanLatest();
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Failed to load.';
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchDraftPlanLatest, fetchEvidence, fetchIntakeLatest, fetchProfileLatest]);

  const runAction = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      setBusy(label);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ApiClientError) {
          setError(`${e.code}: ${e.message}`);
          return null;
        }
        setError(e instanceof Error ? e.message : 'Request failed.');
        return null;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const setSessionError = useCallback((sessionId: string, message: string | null) => {
    setSessionErrors((prev) => {
      const next = { ...prev };
      if (!message) {
        delete next[sessionId];
      } else {
        next[sessionId] = message;
      }
      return next;
    });
  }, []);

  const groupSessionsByWeek = useMemo(() => {
    const sessions: any[] = Array.isArray(draftPlanLatest?.sessions) ? draftPlanLatest.sessions : [];
    const byWeek = new Map<number, any[]>();
    for (const s of sessions) {
      const weekIndex = Number(s.weekIndex);
      if (!byWeek.has(weekIndex)) byWeek.set(weekIndex, []);
      byWeek.get(weekIndex)!.push(s);
    }
    return byWeek;
  }, [draftPlanLatest]);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">AI Plan Builder (v1)</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            Coach-only, feature-flagged. Draft data is isolated from athlete-visible plans.
          </p>
        </div>
        <Link
          className="text-sm underline"
          href={`/coach/athletes/${athleteId}`}
        >
          Back to athlete
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={tab === 'intake' ? 'primary' : 'secondary'}
          size="sm"
          data-testid="apb-tab-intake"
          onClick={() => setTab('intake')}
        >
          Intake Review
        </Button>
        <Button
          type="button"
          variant={tab === 'plan' ? 'primary' : 'secondary'}
          size="sm"
          data-testid="apb-tab-plan"
          onClick={() => setTab('plan')}
        >
          Plan
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              runAction('refresh', async () => {
                const intake = await fetchIntakeLatest();
                if (intake?.id) await fetchEvidence(String(intake.id));
                await fetchProfileLatest();
                await fetchDraftPlanLatest();
              })
            }
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {tab === 'intake' && (
        <div className="mt-6 space-y-4">
          <Block
            title="Latest Intake"
            rightAction={
              intakeLatest?.id ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      runAction('submit-intake', async () => {
                        await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`, {
                          method: 'POST',
                          data: { intakeResponseId: String(intakeLatest.id) },
                        });
                        await fetchIntakeLatest();
                      })
                    }
                  >
                    Submit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      runAction('extract-profile', async () => {
                        await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`, {
                          method: 'POST',
                          data: { intakeResponseId: String(intakeLatest.id) },
                        });
                        await fetchProfileLatest();
                      })
                    }
                  >
                    Extract Profile
                  </Button>
                </div>
              ) : null
            }
          >
            {!intakeLatest ? (
              <div className="text-sm text-[var(--fg-muted)]">No intake found.</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium">Intake ID:</span> {String(intakeLatest.id)}
                </div>
                <div className="text-sm">
                  <span className="font-medium">Status:</span> {String(intakeLatest.status ?? 'UNKNOWN')}
                </div>
                <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">Raw intake JSON</summary>
                  <pre className="mt-3 max-h-64 overflow-auto text-xs">
                    {JSON.stringify(intakeLatest, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </Block>

          <Block title="Evidence">
            {!intakeLatest?.id ? (
              <div className="text-sm text-[var(--fg-muted)]">Load an intake to view evidence.</div>
            ) : intakeEvidence === null ? (
              <div className="text-sm text-[var(--fg-muted)]">Loading…</div>
            ) : intakeEvidence.length === 0 ? (
              <div className="text-sm text-[var(--fg-muted)]">No evidence items.</div>
            ) : (
              <div className="space-y-2">
                {intakeEvidence.map((ev) => (
                  <div
                    key={String(ev?.id ?? `${ev?.kind ?? 'evidence'}-${ev?.createdAt ?? Math.random()}`)}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3"
                  >
                    <div className="text-sm">
                      <span className="font-medium">Kind:</span> {String(ev?.kind ?? 'unknown')}
                    </div>
                    {ev?.url && (
                      <div className="text-sm">
                        <span className="font-medium">URL:</span> {String(ev.url)}
                      </div>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm">Raw</summary>
                      <pre className="mt-2 max-h-56 overflow-auto text-xs">
                        {JSON.stringify(ev, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </Block>

          <Block
            title="Latest Profile"
            rightAction={
              profileLatest?.id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() =>
                    runAction('approve-profile', async () => {
                      await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/profile/approve`, {
                        method: 'POST',
                        data: { profileId: String(profileLatest.id) },
                      });
                      await fetchProfileLatest();
                    })
                  }
                >
                  Approve
                </Button>
              ) : null
            }
          >
            {!profileLatest ? (
              <div className="text-sm text-[var(--fg-muted)]">No profile found.</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium">Profile ID:</span> {String(profileLatest.id)}
                </div>
                <div className="text-sm">
                  <span className="font-medium">Status:</span> {String(profileLatest.status ?? 'UNKNOWN')}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Coach Overrides (JSON)</div>
                  <Textarea
                    rows={6}
                    value={profileOverrideJson}
                    onChange={(e) => setProfileOverrideJson(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        runAction('save-overrides', async () => {
                          let parsed: unknown = {};
                          try {
                            parsed = JSON.parse(profileOverrideJson || '{}');
                          } catch {
                            throw new Error('Invalid JSON in overrides.');
                          }

                          await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/profile/override`, {
                            method: 'PATCH',
                            data: { profileId: String(profileLatest.id), coachOverridesJson: parsed },
                          });
                          await fetchProfileLatest();
                        })
                      }
                    >
                      Save Overrides
                    </Button>
                  </div>
                </div>

                <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">Raw profile JSON</summary>
                  <pre className="mt-3 max-h-64 overflow-auto text-xs">
                    {JSON.stringify(profileLatest, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </Block>
        </div>
      )}

      {tab === 'plan' && (
        <div className="mt-6 space-y-4">
          <Block
            title="Draft Setup"
            rightAction={
              <Button
                type="button"
                size="sm"
                disabled={busy !== null}
                data-testid="apb-generate-draft"
                onClick={() =>
                  runAction('generate', async () => {
                    setSessionErrors({});
                    const created = await request<{ draftPlan: any }>(
                      `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
                      {
                        method: 'POST',
                        data: { setup },
                      }
                    );
                    setDraftPlanLatest(created.draftPlan);
                  })
                }
              >
                Generate Draft
              </Button>
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium">Event date</div>
                <Input
                  type="date"
                  value={setup.eventDate}
                  onChange={(e) => setSetup((s) => ({ ...s, eventDate: e.target.value }))}
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">Weeks to event</div>
                <Input
                  type="number"
                  value={setup.weeksToEvent}
                  min={1}
                  max={52}
                  onChange={(e) => setSetup((s) => ({ ...s, weeksToEvent: Number(e.target.value || 0) }))}
                />
              </div>

              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-medium">Available days</div>
                <div className="flex flex-wrap gap-2">
                  {dayNames.map((d, idx) => {
                    const checked = setup.weeklyAvailabilityDays.includes(idx);
                    return (
                      <label
                        key={d}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(setup.weeklyAvailabilityDays);
                            if (e.target.checked) next.add(idx);
                            else next.delete(idx);
                            setSetup((s) => ({ ...s, weeklyAvailabilityDays: Array.from(next).sort((a, b) => a - b) }));
                          }}
                        />
                        {d}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Weekly minutes</div>
                <Input
                  type="number"
                  value={Number(setup.weeklyAvailabilityMinutes)}
                  min={0}
                  max={10000}
                  onChange={(e) => setSetup((s) => ({ ...s, weeklyAvailabilityMinutes: Number(e.target.value || 0) }))}
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Discipline emphasis</div>
                <Select
                  value={setup.disciplineEmphasis}
                  onChange={(e) =>
                    setSetup((s) => ({ ...s, disciplineEmphasis: e.target.value as any }))
                  }
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
                >
                  <option value="low">Low</option>
                  <option value="med">Medium</option>
                  <option value="high">High</option>
                </Select>
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Max intensity days/week</div>
                <Input
                  type="number"
                  value={setup.maxIntensityDaysPerWeek}
                  min={1}
                  max={3}
                  onChange={(e) =>
                    setSetup((s) => ({ ...s, maxIntensityDaysPerWeek: Number(e.target.value || 0) }))
                  }
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Max doubles/week</div>
                <Input
                  type="number"
                  value={setup.maxDoublesPerWeek}
                  min={0}
                  max={3}
                  onChange={(e) => setSetup((s) => ({ ...s, maxDoublesPerWeek: Number(e.target.value || 0) }))}
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-medium">Long session day (optional)</div>
                <Select
                  value={setup.longSessionDay === null ? '' : String(setup.longSessionDay)}
                  onChange={(e) =>
                    setSetup((s) => ({
                      ...s,
                      longSessionDay: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">Auto</option>
                  {dayNames.map((d, idx) => (
                    <option key={d} value={String(idx)}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Block>

          <Block title="Latest Draft Plan">
            {!draftPlanLatest ? (
              <div className="text-sm text-[var(--fg-muted)]">No draft plan found.</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium">Draft ID:</span> {String(draftPlanLatest.id)}
                </div>

                {(Array.isArray(draftPlanLatest.weeks) ? draftPlanLatest.weeks : []).map((w: any) => {
                  const weekIndex = Number(w.weekIndex);
                  const weekSessions = groupSessionsByWeek.get(weekIndex) ?? [];
                  return (
                    <div
                      key={`week-${weekIndex}`}
                      data-testid="apb-week"
                      data-week-index={String(weekIndex)}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-medium">Week {weekIndex + 1}</div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={Boolean(w.locked)}
                            data-testid="apb-week-lock"
                            onChange={(e) => {
                              const locked = e.target.checked;
                              // Optimistic UI: keep checkbox state stable while request is in-flight.
                              setDraftPlanLatest((prev: any) => {
                                if (!prev) return prev;
                                const next = { ...prev };
                                next.weeks = (next.weeks ?? []).map((x: any) =>
                                  Number(x.weekIndex) === weekIndex ? { ...x, locked } : x
                                );
                                return next;
                              });
                              runAction('lock-week', async () => {
                                const updated = await request<{ draftPlan: any }>(
                                  `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
                                  {
                                    method: 'PATCH',
                                    data: {
                                      draftPlanId: String(draftPlanLatest.id),
                                      weekLocks: [{ weekIndex, locked }],
                                    },
                                  }
                                );
                                setDraftPlanLatest(updated.draftPlan);
                              });
                            }}
                          />
                          Locked
                        </label>
                      </div>

                      <div className="mt-2 text-xs text-[var(--fg-muted)]">
                        Sessions: {String(w.sessionsCount ?? weekSessions.length)} · Total minutes:{' '}
                        {String(w.totalMinutes ?? '')}
                      </div>

                      <div className="mt-3 space-y-3">
                        {weekSessions.map((s: any) => (
                          <div
                            key={String(s.id)}
                            data-testid="apb-session"
                            data-session-id={String(s.id)}
                            data-week-index={String(weekIndex)}
                            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-sm font-medium">
                                {String(s.discipline)} · {dayNames[Number(s.dayOfWeek) % 7]} · #{String(s.ordinal)}
                              </div>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={Boolean(s.locked)}
                                  data-testid="apb-session-lock"
                                  onChange={(e) => {
                                    const locked = e.target.checked;
                                    // Optimistic UI: keep checkbox state stable while request is in-flight.
                                    setDraftPlanLatest((prev: any) => {
                                      if (!prev) return prev;
                                      const next = { ...prev };
                                      next.sessions = (next.sessions ?? []).map((x: any) =>
                                        x.id === s.id ? { ...x, locked } : x
                                      );
                                      return next;
                                    });
                                    runAction('lock-session', async () => {
                                      setSessionError(String(s.id), null);
                                      try {
                                        const updated = await request<{ draftPlan: any }>(
                                          `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
                                          {
                                            method: 'PATCH',
                                            data: {
                                              draftPlanId: String(draftPlanLatest.id),
                                              sessionEdits: [{ sessionId: String(s.id), locked }],
                                            },
                                          }
                                        );
                                        setDraftPlanLatest(updated.draftPlan);
                                      } catch (e) {
                                        if (e instanceof ApiClientError && e.code === 'WEEK_LOCKED') {
                                          setSessionError(String(s.id), 'Week is locked.');
                                          await fetchDraftPlanLatest();
                                          return;
                                        }
                                        throw e;
                                      }
                                    });
                                  }}
                                />
                                Locked
                              </label>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                              <div>
                                <div className="mb-1 text-sm font-medium">Type</div>
                                <Input
                                  value={String(s.type ?? '')}
                                  onChange={(e) => {
                                    const type = e.target.value;
                                    setDraftPlanLatest((prev: any) => {
                                      if (!prev) return prev;
                                      const next = { ...prev };
                                      next.sessions = (next.sessions ?? []).map((x: any) =>
                                        x.id === s.id ? { ...x, type } : x
                                      );
                                      return next;
                                    });
                                  }}
                                />
                              </div>
                              <div>
                                <div className="mb-1 text-sm font-medium">Minutes</div>
                                <Input
                                  type="number"
                                  value={Number(s.durationMinutes ?? 0)}
                                  min={0}
                                  max={10000}
                                  data-testid="apb-session-duration"
                                  onChange={(e) => {
                                    const durationMinutes = Number(e.target.value || 0);
                                    setDraftPlanLatest((prev: any) => {
                                      if (!prev) return prev;
                                      const next = { ...prev };
                                      next.sessions = (next.sessions ?? []).map((x: any) =>
                                        x.id === s.id ? { ...x, durationMinutes } : x
                                      );
                                      return next;
                                    });
                                  }}
                                />
                              </div>
                              <div className="md:col-span-2">
                                <div className="mb-1 text-sm font-medium">Notes</div>
                                <Textarea
                                  rows={3}
                                  value={String(s.notes ?? '')}
                                  onChange={(e) => {
                                    const notes = e.target.value;
                                    setDraftPlanLatest((prev: any) => {
                                      if (!prev) return prev;
                                      const next = { ...prev };
                                      next.sessions = (next.sessions ?? []).map((x: any) =>
                                        x.id === s.id ? { ...x, notes } : x
                                      );
                                      return next;
                                    });
                                  }}
                                />
                              </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={busy !== null}
                                data-testid="apb-session-save"
                                onClick={() =>
                                  runAction('save-session', async () => {
                                    setSessionError(String(s.id), null);
                                    const current = (draftPlanLatest?.sessions ?? []).find((x: any) => x.id === s.id) ?? s;

                                    try {
                                      const updated = await request<{ draftPlan: any }>(
                                        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`,
                                        {
                                          method: 'PATCH',
                                          data: {
                                            draftPlanId: String(draftPlanLatest.id),
                                            sessionEdits: [
                                              {
                                                sessionId: String(s.id),
                                                type: String(current.type ?? ''),
                                                durationMinutes: Number(current.durationMinutes ?? 0),
                                                notes: String(current.notes ?? ''),
                                              },
                                            ],
                                          },
                                        }
                                      );
                                      setDraftPlanLatest(updated.draftPlan);
                                    } catch (e) {
                                      if (e instanceof ApiClientError && e.code === 'SESSION_LOCKED') {
                                        setSessionError(String(s.id), 'Session is locked.');
                                        return;
                                      }
                                      if (e instanceof ApiClientError && e.code === 'WEEK_LOCKED') {
                                        setSessionError(String(s.id), 'Week is locked.');
                                        return;
                                      }
                                      throw e;
                                    }
                                  })
                                }
                              >
                                Save
                              </Button>
                            </div>

                            {sessionErrors[String(s.id)] && (
                              <div
                                className="mt-2 text-sm text-red-700"
                                data-testid="apb-session-error"
                              >
                                {sessionErrors[String(s.id)]}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">Raw draft JSON</summary>
                  <pre className="mt-3 max-h-64 overflow-auto text-xs">
                    {JSON.stringify(draftPlanLatest, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </Block>
        </div>
      )}
    </div>
  );
}
