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

  const [tab, setTab] = useState<'intake' | 'plan' | 'adaptations'>('intake');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [intakeLatest, setIntakeLatest] = useState<any | null>(null);
  const [intakeEvidence, setIntakeEvidence] = useState<any[] | null>(null);
  const [profileLatest, setProfileLatest] = useState<any | null>(null);
  const [draftPlanLatest, setDraftPlanLatest] = useState<any | null>(null);
  const [publishStatus, setPublishStatus] = useState<any | null>(null);
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({});

  const [feedbackLatest, setFeedbackLatest] = useState<any[]>([]);
  const [triggersLatest, setTriggersLatest] = useState<any[]>([]);
  const [proposalsLatest, setProposalsLatest] = useState<any[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalDiffDraft, setProposalDiffDraft] = useState<Record<string, string>>({});
  const [batchApproveSummary, setBatchApproveSummary] = useState<string | null>(null);
  const [lastAppliedAudit, setLastAppliedAudit] = useState<any | null>(null);

  const [proposalPreview, setProposalPreview] = useState<any | null>(null);
  const [proposalPreviewSafety, setProposalPreviewSafety] = useState<any | null>(null);
  const [proposalPreviewLoading, setProposalPreviewLoading] = useState(false);
  const [proposalPreviewError, setProposalPreviewError] = useState<string | null>(null);
  const [publishAfterApproveDraftId, setPublishAfterApproveDraftId] = useState<string | null>(null);

  const [feedbackDraftSessionId, setFeedbackDraftSessionId] = useState<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({
    completedStatus: 'DONE' as 'DONE' | 'PARTIAL' | 'SKIPPED',
    rpe: '' as string,
    feel: '' as '' | 'EASY' | 'OK' | 'HARD' | 'TOO_HARD',
    sorenessFlag: false,
    sorenessNotes: '' as string,
    sleepQuality: '' as string,
  });

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

  const startOfWeekSunday = useCallback((date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  }, []);

  const formatIsoDate = useCallback((d: Date) => d.toISOString().slice(0, 10), []);

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

  const publishDraftPlan = useCallback(
    async (aiPlanDraftId: string) => {
      const data = await request<{ draftPlan: any; publish: any }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish`,
        {
          method: 'POST',
          data: { aiPlanDraftId },
        }
      );

      setDraftPlanLatest(data.draftPlan);
      await fetchPublishStatus(aiPlanDraftId);
      return data;
    },
    [athleteId, fetchPublishStatus, request]
  );

  const fetchFeedback = useCallback(
    async (aiPlanDraftId: string) => {
      const data = await request<{ feedback: any[] }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/feedback?aiPlanDraftId=${encodeURIComponent(aiPlanDraftId)}`
      );
      setFeedbackLatest(Array.isArray(data.feedback) ? data.feedback : []);
      return data.feedback;
    },
    [athleteId, request]
  );

  const fetchProposals = useCallback(
    async (aiPlanDraftId: string) => {
      const data = await request<{ proposals: any[] }>(
        `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals?aiPlanDraftId=${encodeURIComponent(aiPlanDraftId)}&limit=200`
      );
      setProposalsLatest(Array.isArray(data.proposals) ? data.proposals : []);
      return data.proposals;
    },
    [athleteId, request]
  );

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
        const draft = await fetchDraftPlanLatest();
        if (!cancelled && draft?.id) {
          await Promise.all([
            fetchFeedback(String(draft.id)),
            fetchProposals(String(draft.id)),
            fetchPublishStatus(String(draft.id)),
          ]);
        } else if (!cancelled) {
          setPublishStatus(null);
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Failed to load.';
        setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchDraftPlanLatest, fetchEvidence, fetchFeedback, fetchIntakeLatest, fetchProfileLatest, fetchProposals, fetchPublishStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedProposalId || !draftPlanLatest?.id) {
        setProposalPreview(null);
        setProposalPreviewSafety(null);
        setProposalPreviewError(null);
        return;
      }

      try {
        setProposalPreviewLoading(true);
        setProposalPreviewError(null);

        const res = await request<{ preview: any; applySafety: any }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/${encodeURIComponent(
            String(selectedProposalId)
          )}/preview?aiPlanDraftId=${encodeURIComponent(String(draftPlanLatest.id))}`
        );

        if (cancelled) return;
        setProposalPreview(res.preview ?? null);
        setProposalPreviewSafety((res as any).applySafety ?? null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setProposalPreviewError(`${e.code}: ${e.message}`);
        } else {
          setProposalPreviewError(e instanceof Error ? e.message : 'Failed to load preview.');
        }
        setProposalPreview(null);
        setProposalPreviewSafety(null);
      } finally {
        if (!cancelled) setProposalPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [athleteId, draftPlanLatest?.id, request, selectedProposalId]);

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
          href={{ pathname: '/coach/athletes', query: { athleteId } }}
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
        <Button
          type="button"
          variant={tab === 'adaptations' ? 'primary' : 'secondary'}
          size="sm"
          data-testid="apb-tab-adaptations"
          onClick={() => setTab('adaptations')}
        >
          Adaptations
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
                const draft = await fetchDraftPlanLatest();
                if (draft?.id) {
                  await Promise.all([fetchFeedback(String(draft.id)), fetchProposals(String(draft.id))]);
                }
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
            title="Publish"
            rightAction={
              <Button
                type="button"
                size="sm"
                disabled={busy !== null || !draftPlanLatest?.id}
                data-testid="apb-publish"
                onClick={() =>
                  runAction('publish', async () => {
                    const id = String(draftPlanLatest?.id || '');
                    if (!id) return;
                    await publishDraftPlan(id);
                  })
                }
              >
                Publish to athlete
              </Button>
            }
          >
            {!draftPlanLatest?.id ? (
              <div className="text-sm text-[var(--fg-muted)]">Generate a draft plan to enable publishing.</div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span
                    className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-2 py-1 text-xs"
                    data-testid="apb-publish-status"
                  >
                    {publishStatus?.visibilityStatus === 'PUBLISHED' ? 'Published' : 'Draft'}
                  </span>
                  <span className="text-[var(--fg-muted)]">Draft ID: {String(draftPlanLatest.id)}</span>
                </div>
                <div className="text-xs text-[var(--fg-muted)]">
                  Last published:{' '}
                  <span data-testid="apb-publish-last-published">
                    {publishStatus?.publishedAt ? new Date(publishStatus.publishedAt).toLocaleString() : '—'}
                  </span>
                </div>
                <div className="text-xs text-[var(--fg-muted)]">Summary:</div>
                <pre className="whitespace-pre-wrap text-xs text-[var(--fg-muted)]" data-testid="apb-publish-summary">
                  {publishStatus?.lastPublishedSummaryText ?? '—'}
                </pre>
                <div className="text-xs text-[var(--fg-muted)]">
                  Athlete view: <span className="font-mono">/athlete/ai-plan/{String(draftPlanLatest.id)}</span>
                </div>
              </div>
            )}
          </Block>

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
                    if (created.draftPlan?.id) {
                      void fetchPublishStatus(String(created.draftPlan.id)).catch(() => {
                        setPublishStatus(null);
                      });
                    } else {
                      setPublishStatus(null);
                    }
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

      {tab === 'adaptations' && (
        <div className="mt-6 space-y-4">
          <Block title="Feedback (Draft-only)">
            {!draftPlanLatest?.id ? (
              <div className="text-sm text-[var(--fg-muted)]">Generate or load a draft plan first.</div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-[var(--fg-muted)]">
                  Feedback is stored in AI-local tables and only affects AiPlanDraft.
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium">Upcoming sessions (next 7 days)</div>
                  <div className="space-y-2">
                    {(() => {
                      const sessions: any[] = Array.isArray(draftPlanLatest?.sessions) ? draftPlanLatest.sessions : [];
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const week0 = startOfWeekSunday(today);
                      const end = new Date(today);
                      end.setDate(end.getDate() + 7);

                      const upcoming = sessions
                        .map((s) => {
                          const date = new Date(week0);
                          date.setDate(date.getDate() + Number(s.weekIndex) * 7 + Number(s.dayOfWeek));
                          return { ...s, _date: date };
                        })
                        .filter((s) => s._date >= today && s._date <= end)
                        .sort((a, b) => a._date.getTime() - b._date.getTime() || a.ordinal - b.ordinal);

                      if (!upcoming.length) {
                        return <div className="text-sm text-[var(--fg-muted)]">No sessions in the next 7 days.</div>;
                      }

                      return upcoming.map((s) => (
                        <div
                          key={String(s.id)}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3"
                          data-testid="apb-feedback-session"
                          data-session-id={String(s.id)}
                        >
                          <div className="text-sm">
                            <span className="font-medium">{formatIsoDate(s._date)}</span> · Week {Number(s.weekIndex) + 1} · {dayNames[Number(s.dayOfWeek) % 7]} · {String(s.type)} · {Number(s.durationMinutes)}m
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            data-testid="apb-feedback-log"
                            disabled={busy !== null}
                            onClick={() => {
                              setProposalError(null);
                              setFeedbackDraftSessionId(String(s.id));
                              setFeedbackForm({
                                completedStatus: 'DONE',
                                rpe: '',
                                feel: '',
                                sorenessFlag: false,
                                sorenessNotes: '',
                                sleepQuality: '',
                              });
                            }}
                          >
                            Log feedback
                          </Button>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {feedbackDraftSessionId && (
                  <div
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3"
                    data-testid="apb-feedback-form"
                  >
                    <div className="mb-2 text-sm font-medium">Log feedback</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-sm font-medium">Status</div>
                        <Select
                          value={feedbackForm.completedStatus}
                          onChange={(e) => setFeedbackForm((f) => ({ ...f, completedStatus: e.target.value as any }))}
                        >
                          <option value="DONE">Done</option>
                          <option value="PARTIAL">Partial</option>
                          <option value="SKIPPED">Skipped</option>
                        </Select>
                      </div>
                      <div>
                        <div className="mb-1 text-sm font-medium">RPE (0-10)</div>
                        <Input
                          type="number"
                          value={feedbackForm.rpe}
                          min={0}
                          max={10}
                          onChange={(e) => setFeedbackForm((f) => ({ ...f, rpe: e.target.value }))}
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-sm font-medium">Feel</div>
                        <Select
                          value={feedbackForm.feel}
                          onChange={(e) => setFeedbackForm((f) => ({ ...f, feel: e.target.value as any }))}
                        >
                          <option value="">(none)</option>
                          <option value="EASY">Easy</option>
                          <option value="OK">OK</option>
                          <option value="HARD">Hard</option>
                          <option value="TOO_HARD">Too hard</option>
                        </Select>
                      </div>
                      <div>
                        <div className="mb-1 text-sm font-medium">Sleep quality (0-10)</div>
                        <Input
                          type="number"
                          value={feedbackForm.sleepQuality}
                          min={0}
                          max={10}
                          onChange={(e) => setFeedbackForm((f) => ({ ...f, sleepQuality: e.target.value }))}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={feedbackForm.sorenessFlag}
                            onChange={(e) => setFeedbackForm((f) => ({ ...f, sorenessFlag: e.target.checked }))}
                          />
                          Soreness flag
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <div className="mb-1 text-sm font-medium">Soreness notes</div>
                        <Textarea
                          rows={3}
                          value={feedbackForm.sorenessNotes}
                          onChange={(e) => setFeedbackForm((f) => ({ ...f, sorenessNotes: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        data-testid="apb-feedback-save"
                        onClick={() =>
                          runAction('save-feedback', async () => {
                            setProposalError(null);
                            const aiPlanDraftId = String(draftPlanLatest.id);
                            const draftSessionId = String(feedbackDraftSessionId);

                            await request(`/api/coach/athletes/${athleteId}/ai-plan-builder/feedback`, {
                              method: 'POST',
                              data: {
                                aiPlanDraftId,
                                draftSessionId,
                                completedStatus: feedbackForm.completedStatus,
                                rpe: feedbackForm.rpe === '' ? null : Number(feedbackForm.rpe),
                                feel: feedbackForm.feel === '' ? null : feedbackForm.feel,
                                sorenessFlag: Boolean(feedbackForm.sorenessFlag),
                                sorenessNotes: feedbackForm.sorenessNotes ? String(feedbackForm.sorenessNotes) : null,
                                sleepQuality: feedbackForm.sleepQuality === '' ? null : Number(feedbackForm.sleepQuality),
                              },
                            });

                            await fetchFeedback(aiPlanDraftId);
                            setFeedbackDraftSessionId(null);
                          })
                        }
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => setFeedbackDraftSessionId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">Latest feedback (raw)</summary>
                  <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(feedbackLatest, null, 2)}</pre>
                </details>
              </div>
            )}
          </Block>

          <Block title="Evaluate Triggers + Proposals">
            {!draftPlanLatest?.id ? (
              <div className="text-sm text-[var(--fg-muted)]">Generate or load a draft plan first.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy !== null}
                    data-testid="apb-evaluate-triggers"
                    onClick={() =>
                      runAction('evaluate-triggers', async () => {
                        setProposalError(null);
                        const res = await request<{ triggers: any[] }>(
                          `/api/coach/athletes/${athleteId}/ai-plan-builder/adaptations/evaluate`,
                          {
                            method: 'POST',
                            data: { aiPlanDraftId: String(draftPlanLatest.id), windowDays: 10 },
                          }
                        );
                        setTriggersLatest(Array.isArray((res as any).triggers) ? (res as any).triggers : []);
                      })
                    }
                  >
                    Evaluate
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    data-testid="apb-evaluate-generate"
                    onClick={() =>
                      runAction('evaluate+generate', async () => {
                        setProposalError(null);
                        const evalRes = await request<{ triggers: any[] }>(
                          `/api/coach/athletes/${athleteId}/ai-plan-builder/adaptations/evaluate`,
                          {
                            method: 'POST',
                            data: { aiPlanDraftId: String(draftPlanLatest.id), windowDays: 10 },
                          }
                        );
                        setTriggersLatest(Array.isArray((evalRes as any).triggers) ? (evalRes as any).triggers : []);

                        const genRes = await request<{ proposal: any }>(
                          `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/generate`,
                          {
                            method: 'POST',
                            data: { aiPlanDraftId: String(draftPlanLatest.id) },
                          }
                        );

                        if ((genRes as any)?.proposal?.id) {
                          setSelectedProposalId(String((genRes as any).proposal.id));
                        }

                        await fetchProposals(String(draftPlanLatest.id));
                      })
                    }
                  >
                    Evaluate + Generate
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    data-testid="apb-generate-proposal"
                    onClick={() =>
                      runAction('generate-proposal', async () => {
                        setProposalError(null);
                        const res = await request<{ proposal: any }>(
                          `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/generate`,
                          {
                            method: 'POST',
                            data: { aiPlanDraftId: String(draftPlanLatest.id) },
                          }
                        );
                        if ((res as any)?.proposal?.id) {
                          setSelectedProposalId(String((res as any).proposal.id));
                        }
                        await fetchProposals(String(draftPlanLatest.id));
                      })
                    }
                  >
                    Generate proposal
                  </Button>
                </div>

                {proposalError && (
                  <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="apb-proposal-error">
                    {proposalError}
                  </div>
                )}

                {batchApproveSummary && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3 text-sm" data-testid="apb-batch-approve-summary">
                    {batchApproveSummary}
                  </div>
                )}

                {lastAppliedAudit?.id && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3 text-sm" data-testid="apb-last-audit">
                    Applied (audit {String(lastAppliedAudit.id)}).
                  </div>
                )}

                <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">Latest triggers (raw)</summary>
                  <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(triggersLatest, null, 2)}</pre>
                </details>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3">
                    <div className="text-sm font-medium">Proposals</div>
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy !== null || !draftPlanLatest?.id}
                          data-testid="apb-batch-approve"
                          onClick={() =>
                            runAction('batch-approve', async () => {
                              setProposalError(null);
                              setBatchApproveSummary(null);
                              const res = await request<{ batch: { approvedCount: number; failedCount: number; results: any[]; draft: any | null } }>(
                                `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/batch-approve`,
                                {
                                  method: 'POST',
                                  data: { aiPlanDraftId: String(draftPlanLatest.id), maxHours: 72 },
                                }
                              );
                              const approvedCount = Number((res as any)?.batch?.approvedCount ?? 0);
                              const failedCount = Number((res as any)?.batch?.failedCount ?? 0);
                              setBatchApproveSummary(`Batch approve: ${approvedCount} approved, ${failedCount} failed.`);

                              if ((res as any)?.batch?.draft) {
                                setDraftPlanLatest((res as any).batch.draft);
                              }

                              await fetchProposals(String(draftPlanLatest.id));
                            })
                          }
                        >
                          Batch approve safe (72h)
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          disabled={busy !== null || !draftPlanLatest?.id}
                          data-testid="apb-batch-approve-publish"
                          onClick={() =>
                            runAction('batch-approve-and-publish', async () => {
                              setProposalError(null);
                              setBatchApproveSummary(null);
                              setPublishAfterApproveDraftId(null);

                              const res = await request<any>(
                                `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/batch-approve`,
                                {
                                  method: 'POST',
                                  data: { aiPlanDraftId: String(draftPlanLatest.id), maxHours: 72, mode: 'approve_and_publish' },
                                }
                              );

                              const approvedCount = Number((res as any)?.batch?.approvedCount ?? 0);
                              const failedCount = Number((res as any)?.batch?.failedCount ?? 0);
                              const publish = (res as any)?.publish;

                              let publishText = '';
                              if (publish?.ok === true && publish?.skipped) publishText = ' publish skipped';
                              else if (publish?.ok === true) publishText = ` publish=${publish?.published ? 'published' : 'no-changes'}`;
                              else if (publish?.ok === false) publishText = ` publish failed (${publish?.code ?? 'PUBLISH_FAILED'})`;

                              setBatchApproveSummary(`Batch approve: ${approvedCount} approved, ${failedCount} failed.${publishText}`);

                              if ((res as any)?.batch?.draft) {
                                setDraftPlanLatest((res as any).batch.draft);
                              }
                              if (publish?.ok === true && (publish?.hash || publish?.published)) {
                                await fetchPublishStatus(String(draftPlanLatest.id));
                              }

                              await fetchProposals(String(draftPlanLatest.id));
                            })
                          }
                        >
                          Batch approve & publish
                        </Button>
                      </div>
                      {proposalsLatest.filter((p) => p?.status === 'PROPOSED').length === 0 ? (
                        <div className="text-sm text-[var(--fg-muted)]">No proposed items.</div>
                      ) : (
                        proposalsLatest
                          .filter((p) => p?.status === 'PROPOSED')
                          .map((p) => (
                            <button
                              key={String(p.id)}
                              type="button"
                              data-testid="apb-proposal-item"
                              data-proposal-id={String(p.id)}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                                selectedProposalId === String(p.id)
                                  ? 'border-[var(--border-strong)] bg-[var(--bg-card)]'
                                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)]'
                              }`}
                              onClick={() => {
                                setProposalError(null);
                                setBatchApproveSummary(null);
                                setSelectedProposalId(String(p.id));
                                setProposalDiffDraft((prev) => {
                                  const key = String(p.id);
                                  if (prev[key]) return prev;
                                  return {
                                    ...prev,
                                    [key]: JSON.stringify(Array.isArray((p as any)?.diffJson) ? (p as any).diffJson : [], null, 2),
                                  };
                                });
                              }}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium">{String(p.status)}</div>
                                <div className="text-xs text-[var(--fg-muted)]">
                                  {p.respectsLocks ? 'respectsLocks' : 'blockedByLocks'}
                                </div>
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs text-[var(--fg-muted)]">
                                {String(p.rationaleText ?? '').split('\n')[0]}
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3">
                    <div className="text-sm font-medium">Proposal detail</div>
                    {(() => {
                      const proposal = proposalsLatest.find((p) => String(p.id) === String(selectedProposalId ?? ''));
                      if (!proposal) {
                        return <div className="mt-2 text-sm text-[var(--fg-muted)]">Select a proposal.</div>;
                      }

                      const diff: any[] = Array.isArray(proposal.diffJson) ? proposal.diffJson : [];
                      const draftKey = String(proposal.id);
                      const draftText = proposalDiffDraft[draftKey] ?? JSON.stringify(diff, null, 2);

                      return (
                        <div className="mt-2 space-y-3" data-testid="apb-proposal-detail">
                          <div className="text-xs text-[var(--fg-muted)]">ID: {String(proposal.id)}</div>
                          <div className="text-sm">{String(proposal.rationaleText ?? '').split('\n')[0]}</div>

                          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
                            <div className="text-xs font-medium">Diff preview</div>

                            {proposalPreviewLoading ? (
                              <div className="mt-2 text-xs text-[var(--fg-muted)]">Loading preview…</div>
                            ) : proposalPreviewError ? (
                              <div className="mt-2 text-xs text-red-700" data-testid="apb-proposal-preview-error">
                                {proposalPreviewError}
                              </div>
                            ) : proposalPreview ? (
                              <div className="mt-2 space-y-2" data-testid="apb-proposal-preview">
                                <div className="flex flex-wrap items-center gap-3 text-xs">
                                  <div>
                                    Sessions changed: <span className="font-medium">{Number(proposalPreview?.summary?.sessionsChangedCount ?? 0)}</span>
                                  </div>
                                  <div>
                                    Minutes delta:{' '}
                                    <span className="font-medium">
                                      {(() => {
                                        const d = Number(proposalPreview?.summary?.totalMinutesDelta ?? 0);
                                        return d > 0 ? `+${d}` : String(d);
                                      })()}
                                    </span>
                                  </div>
                                  <div>
                                    Intensity delta:{' '}
                                    <span className="font-medium">
                                      {(() => {
                                        const d = proposalPreview?.summary?.intensitySessionsDelta;
                                        if (d === null || d === undefined) return '—';
                                        const n = Number(d);
                                        return n > 0 ? `+${n}` : String(n);
                                      })()}
                                    </span>
                                  </div>
                                </div>

                                {proposalPreviewSafety?.wouldFailDueToLocks ? (
                                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs" data-testid="apb-proposal-lock-warning">
                                    <div className="font-medium">Would fail due to locks</div>
                                    <ul className="mt-1 list-disc space-y-1 pl-5">
                                      {(proposalPreviewSafety?.reasons ?? []).map((r: any, idx: number) => (
                                        <li key={idx}>
                                          {String(r.code)}: {String(r.message)}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}

                                <div className="space-y-2">
                                  {(proposalPreview?.weeks ?? []).map((w: any) => (
                                    <div key={String(w.weekIndex)} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2">
                                      <div className="flex items-center justify-between gap-2 text-xs">
                                        <div className="font-medium">Week {Number(w.weekIndex ?? 0) + 1}</div>
                                        <div className="text-[var(--fg-muted)]">
                                          {Number(w.beforeTotalMinutes ?? 0)} → {Number(w.afterTotalMinutes ?? 0)} min
                                        </div>
                                      </div>
                                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                                        {(w.items ?? []).length === 0 ? (
                                          <li className="text-[var(--fg-muted)]">No changes.</li>
                                        ) : (
                                          (w.items ?? []).map((it: any, idx: number) => (
                                            <li key={idx} data-testid="apb-proposal-preview-item">
                                              {String(it.text)}
                                            </li>
                                          ))
                                        )}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--fg-muted)]">
                                {diff.length === 0 ? <li>No ops.</li> : <li>Preview unavailable.</li>}
                              </ul>
                            )}
                          </div>

                          <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
                            <summary className="cursor-pointer text-xs font-medium">Quick tweak (edit diffJson)</summary>
                            <div className="mt-2 space-y-2">
                              <textarea
                                className="min-h-40 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2 font-mono text-xs"
                                value={draftText}
                                onChange={(e) => {
                                  const value = e.currentTarget.value;
                                  setProposalDiffDraft((prev) => ({ ...prev, [draftKey]: value }));
                                }}
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={busy !== null || proposal.status !== 'PROPOSED'}
                                  data-testid="apb-proposal-save-diff"
                                  onClick={() =>
                                    runAction('save-proposal-diff', async () => {
                                      setProposalError(null);
                                      setBatchApproveSummary(null);
                                      let parsed: any;
                                      try {
                                        parsed = JSON.parse(draftText);
                                      } catch {
                                        setProposalError('Invalid JSON in diffJson editor.');
                                        return;
                                      }

                                      await request(
                                        `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/${encodeURIComponent(
                                          String(proposal.id)
                                        )}/diff`,
                                        {
                                          method: 'PATCH',
                                          data: { diffJson: parsed },
                                        }
                                      );
                                      await fetchProposals(String(draftPlanLatest.id));
                                    })
                                  }
                                >
                                  Save diff
                                </Button>
                              </div>
                              <div className="text-xs text-[var(--fg-muted)]">
                                Edits update the proposal only; approval still enforces current locks.
                              </div>
                            </div>
                          </details>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy !== null || proposal.status !== 'PROPOSED'}
                              data-testid="apb-proposal-approve"
                              onClick={() =>
                                runAction('approve-proposal', async () => {
                                  setProposalError(null);
                                  try {
                                    const res = await request<{ draft: any; audit: any; proposal: any }>(
                                      `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/${encodeURIComponent(
                                        String(proposal.id)
                                      )}/approve`,
                                      { method: 'POST' }
                                    );
                                    if ((res as any)?.draft) {
                                      setDraftPlanLatest((res as any).draft);
                                    }
                                    if ((res as any)?.audit) {
                                      setLastAppliedAudit((res as any).audit);
                                    }
                                    await fetchProposals(String(draftPlanLatest.id));
                                  } catch (e) {
                                    if (e instanceof ApiClientError && (e.code === 'SESSION_LOCKED' || e.code === 'WEEK_LOCKED')) {
                                      setProposalError(`${e.code}: ${e.message}`);
                                      return;
                                    }
                                    throw e;
                                  }
                                })
                              }
                            >
                              Approve
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              disabled={busy !== null || proposal.status !== 'PROPOSED' || !draftPlanLatest?.id}
                              data-testid="apb-proposal-approve-publish"
                              onClick={() =>
                                runAction('approve-proposal-and-publish', async () => {
                                  setProposalError(null);
                                  setPublishAfterApproveDraftId(null);
                                  try {
                                    const res = await request<any>(
                                      `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/${encodeURIComponent(
                                        String(proposal.id)
                                      )}/approve-and-publish`,
                                      { method: 'POST', data: { aiPlanDraftId: String(draftPlanLatest.id) } }
                                    );

                                    const approval = (res as any)?.approval;
                                    const publish = (res as any)?.publish;

                                    if (approval?.draft) setDraftPlanLatest(approval.draft);
                                    if (approval?.audit) setLastAppliedAudit(approval.audit);

                                    if (publish?.ok === true) {
                                      await fetchPublishStatus(String(draftPlanLatest.id));
                                    } else if (publish?.ok === false) {
                                      setProposalError(`PUBLISH_FAILED: ${publish?.message ?? 'Publish failed.'}`);
                                      setPublishAfterApproveDraftId(String(draftPlanLatest.id));
                                    }

                                    await fetchProposals(String(draftPlanLatest.id));
                                  } catch (e) {
                                    if (e instanceof ApiClientError && (e.code === 'SESSION_LOCKED' || e.code === 'WEEK_LOCKED')) {
                                      setProposalError(`${e.code}: ${e.message}`);
                                      return;
                                    }
                                    throw e;
                                  }
                                })
                              }
                            >
                              Approve & Publish
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busy !== null || proposal.status !== 'PROPOSED'}
                              data-testid="apb-proposal-reject"
                              onClick={() =>
                                runAction('reject-proposal', async () => {
                                  setProposalError(null);
                                  await request(
                                    `/api/coach/athletes/${athleteId}/ai-plan-builder/proposals/${encodeURIComponent(
                                      String(proposal.id)
                                    )}/reject`,
                                    { method: 'POST' }
                                  );
                                  await fetchProposals(String(draftPlanLatest.id));
                                  setSelectedProposalId(null);
                                })
                              }
                            >
                              Reject
                            </Button>

                            {publishAfterApproveDraftId ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={busy !== null}
                                data-testid="apb-publish-now"
                                onClick={() =>
                                  runAction('publish-now', async () => {
                                    await publishDraftPlan(String(publishAfterApproveDraftId));
                                    setPublishAfterApproveDraftId(null);
                                  })
                                }
                              >
                                Publish now
                              </Button>
                            ) : null}
                          </div>

                          <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
                            <summary className="cursor-pointer text-xs font-medium">Raw proposal JSON</summary>
                            <pre className="mt-2 max-h-48 overflow-auto text-xs">{JSON.stringify(proposal, null, 2)}</pre>
                          </details>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </Block>
        </div>
      )}
    </div>
  );
}
