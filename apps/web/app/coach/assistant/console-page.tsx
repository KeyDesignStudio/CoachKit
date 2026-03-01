'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ApiClientError, useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { SelectField } from '@/components/ui/SelectField';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import { formatDisplayInTimeZone } from '@/lib/client-date';
import { tokens } from '@/components/ui/tokens';

type AssistantState = 'NEW' | 'NEEDS_ATTENTION' | 'SNOOZED' | 'ACTIONED' | 'DISMISSED';

type DetectionCard = {
  id: string;
  athleteId: string;
  athleteName: string;
  detectedAt: string;
  title: string;
  patternKey: string;
  category: string;
  summary: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceScore: number;
  state: AssistantState;
  snoozedUntil: string | null;
};

type DetectionDetail = {
  id: string;
  athleteId: string;
  coachId: string;
  detectedAt: string;
  periodStart: string;
  periodEnd: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceScore: number;
  evidence: unknown;
  state: AssistantState;
  dismissReason: string | null;
  snoozedUntil: string | null;
  athlete: { user: { id: string; name: string | null } | null };
  patternDefinition: {
    id: string;
    key: string;
    name: string;
    category: string;
    version: number;
  };
  recommendations: Array<{
    id: string;
    recommendationType: string;
    title: string;
    details: unknown;
    estimatedImpact: unknown;
  }>;
  llmOutputs: Array<{
    id: string;
    outputType: 'COACH_SUMMARY' | 'ATHLETE_MESSAGE_DRAFT' | 'RATIONALE' | 'CHATBOT_CONTEXT_PACK';
    content: string;
    createdAt: string;
  }>;
};

function SeverityPill({ severity }: { severity: DetectionCard['severity'] | DetectionDetail['severity'] }) {
  const tone =
    severity === 'HIGH'
      ? 'bg-rose-100 text-rose-700'
      : severity === 'MEDIUM'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-emerald-100 text-emerald-700';

  return <span className={cn('rounded-full px-2 py-1 text-xs font-semibold tracking-wide', tone)}>{severity}</span>;
}

function compactJson(value: unknown) {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) return '';
    return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text;
  } catch {
    return '';
  }
}

type AssistantConsolePageProps = {
  athleteId?: string | null;
  embedded?: boolean;
};

export default function AssistantConsolePage({ athleteId = null, embedded = false }: AssistantConsolePageProps) {
  const router = useRouter();
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const [stateFilter, setStateFilter] = useState<AssistantState>('NEW');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<DetectionCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<DetectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [dismissReason, setDismissReason] = useState('Not actionable right now');
  const [messageDraft, setMessageDraft] = useState('');
  const [messageTone, setMessageTone] = useState<'direct' | 'encouraging' | 'matter_of_fact'>('matter_of_fact');
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [planReviewHref, setPlanReviewHref] = useState('');
  const [busyAction, setBusyAction] = useState<string>('');

  const timeZone = user?.timezone ?? 'Australia/Brisbane';

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const summaryBullets = useMemo(() => {
    if (!detail) return [] as string[];
    const fromSummary = detail.llmOutputs
      .filter((row) => row.outputType === 'COACH_SUMMARY')
      .flatMap((row) => row.content.split(/\n+/))
      .map((row) => row.replace(/^[-*\s]+/, '').trim())
      .filter(Boolean);

    if (fromSummary.length > 0) return fromSummary.slice(0, 3);

    return ['Pattern detected with repeatable evidence over recent sessions.', 'Recommendation options are available below.'];
  }, [detail]);

  const loadDetections = useCallback(
    async (filter: AssistantState, keepSelected = false) => {
      if (!user?.userId || (user.role !== 'COACH' && user.role !== 'ADMIN')) return;
      setLoading(true);
      setError('');
      setStatusText('');
      try {
        const data = await request<{ items: DetectionCard[] }>(
          `/api/coach/assistant/detections?state=${encodeURIComponent(filter)}&limit=50&offset=0${
            athleteId ? `&athleteId=${encodeURIComponent(athleteId)}` : ''
          }`,
          { cache: 'no-store' }
        );
        const rows = Array.isArray(data.items) ? data.items : [];
        setItems(rows);

        if (!keepSelected) {
          const nextSelected = rows[0]?.id ?? null;
          setSelectedId(nextSelected);
          if (nextSelected) {
            void loadDetection(nextSelected);
          } else {
            setDetail(null);
          }
          return;
        }

        const currentSelectedId = selectedIdRef.current;
        if (currentSelectedId && rows.some((row) => row.id === currentSelectedId)) {
          void loadDetection(currentSelectedId);
          return;
        }

        const nextSelected = rows[0]?.id ?? null;
        setSelectedId(nextSelected);
        if (nextSelected) {
          void loadDetection(nextSelected);
        } else {
          setDetail(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load assistant inbox.');
      } finally {
        setLoading(false);
      }
    },
    [athleteId, request, user?.role, user?.userId]
  );

  const loadDetection = useCallback(
    async (detectionId: string) => {
      setDetailLoading(true);
      setError('');
      try {
        const data = await request<{ detection: DetectionDetail }>(`/api/coach/assistant/detections/${encodeURIComponent(detectionId)}`, {
          cache: 'no-store',
        });
        setDetail(data.detection);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load detection detail.');
      } finally {
        setDetailLoading(false);
      }
    },
    [request]
  );

  useEffect(() => {
    if (user?.role === 'COACH' || user?.role === 'ADMIN') {
      void loadDetections(stateFilter);
    }
  }, [loadDetections, stateFilter, user?.role]);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusyAction(key);
      setStatusText('');
      setPlanReviewHref('');
      setError('');
      try {
        await fn();
        await loadDetections(stateFilter, true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed.');
      } finally {
        setBusyAction('');
      }
    },
    [loadDetections, stateFilter]
  );

  if (userLoading) {
    return <p className={tokens.typography.bodyMuted}>Loading assistant…</p>;
  }

  if (!user || (user.role !== 'COACH' && user.role !== 'ADMIN')) {
    return <p className={tokens.typography.bodyMuted}>Coach access required.</p>;
  }

  return (
    <section className={cn(tokens.spacing.dashboardSectionGap)}>
      {!embedded ? (
        <Block>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className={tokens.typography.sectionLabel}>Invisible Assistant Coach</p>
              <h1 className={tokens.typography.h1}>Assistant Inbox</h1>
              <p className={cn('mt-1', tokens.typography.bodyMuted)}>High-signal detections with explainable evidence and one-click actions.</p>
            </div>

            <div className="w-full md:w-[280px]">
              <SelectField
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value as AssistantState)}
              >
                <option value="NEW">New</option>
                <option value="NEEDS_ATTENTION">Needs attention</option>
                <option value="SNOOZED">Snoozed</option>
                <option value="ACTIONED">Actioned</option>
                <option value="DISMISSED">Dismissed</option>
              </SelectField>
            </div>
          </div>
        </Block>
      ) : (
        <Block>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className={tokens.typography.sectionLabel}>Signals Assistant</p>
              <h2 className={tokens.typography.h2}>AI Signals And Recommendations</h2>
              <p className={cn('mt-1', tokens.typography.bodyMuted)}>Evidence-backed detections and safe proposal handoff into the plan workflow.</p>
            </div>
            <div className="w-full md:w-[280px]">
              <SelectField
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value as AssistantState)}
              >
                <option value="NEW">New</option>
                <option value="NEEDS_ATTENTION">Needs attention</option>
                <option value="SNOOZED">Snoozed</option>
                <option value="ACTIONED">Actioned</option>
                <option value="DISMISSED">Dismissed</option>
              </SelectField>
            </div>
          </div>
        </Block>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <Block title="Detections" className="h-full">
            {loading ? <p className={tokens.typography.bodyMuted}>Loading detections…</p> : null}
            {!loading && items.length === 0 ? <p className={tokens.typography.bodyMuted}>No detections in this state.</p> : null}

            <div className="space-y-3">
              {items.map((item) => {
                const isActive = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      void loadDetection(item.id);
                    }}
                    className={cn(
                      'w-full rounded-2xl border p-3 text-left transition-colors',
                      isActive
                        ? 'border-[var(--ring)] bg-[var(--bg-structure)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-structure)]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn('truncate', tokens.typography.bodySemi)}>{item.athleteName}</p>
                        <p className={cn('truncate', tokens.typography.bodyBold)}>{item.title}</p>
                      </div>
                      <SeverityPill severity={item.severity} />
                    </div>

                    <p className={cn('mt-2 line-clamp-2', tokens.typography.bodyMuted)}>{item.summary}</p>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className={tokens.typography.meta}>{formatDisplayInTimeZone(item.detectedAt, timeZone)}</span>
                      <span className="rounded-full bg-[var(--bg-structure)] px-2 py-1 text-xs font-semibold text-[var(--text)]">
                        {item.confidenceScore}% confidence
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Block>
        </div>

        <div className="xl:col-span-7">
          <Block title="Insight" className="h-full">
            {detailLoading ? <p className={tokens.typography.bodyMuted}>Loading detail…</p> : null}
            {!detailLoading && !detail ? <p className={tokens.typography.bodyMuted}>Select a detection to view evidence and actions.</p> : null}

            {detail ? (
              <div className={cn(tokens.spacing.blockGapY)}>
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={tokens.typography.h3}>{detail.patternDefinition.name}</p>
                    <SeverityPill severity={detail.severity} />
                    <span className="rounded-full bg-[var(--bg-structure)] px-2 py-1 text-xs font-semibold text-[var(--text)]">
                      {detail.confidenceScore}%
                    </span>
                  </div>
                  <p className={cn('mt-1', tokens.typography.meta)}>
                    {detail.athlete.user?.name ?? 'Athlete'} · {formatDisplayInTimeZone(detail.detectedAt, timeZone)}
                  </p>
                </div>

                <div>
                  <p className={tokens.typography.sectionLabel}>What I am seeing</p>
                  <div className="mt-2 space-y-2">
                    {summaryBullets.map((line, index) => (
                      <p key={`${line}-${index}`} className={tokens.typography.body}>
                        {line}
                      </p>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={tokens.typography.sectionLabel}>Evidence</p>
                  <pre className={cn('mt-2 max-h-40 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-3', tokens.typography.meta)}>
                    {compactJson(detail.evidence) || 'No structured evidence payload found.'}
                  </pre>
                </div>

                <div>
                  <p className={tokens.typography.sectionLabel}>Recommended actions</p>
                  <div className="mt-2 space-y-2">
                    {detail.recommendations.length === 0 ? <p className={tokens.typography.bodyMuted}>No recommendations available.</p> : null}
                    {detail.recommendations.map((recommendation) => (
                      <div key={recommendation.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                        <p className={tokens.typography.bodySemi}>{recommendation.title}</p>
                        <p className={cn('mt-1', tokens.typography.meta)}>{recommendation.recommendationType}</p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            disabled={Boolean(busyAction)}
                            onClick={() =>
                              void runAction('apply-plan', async () => {
                                try {
                                  const resp = await request<{ proposal: { id: string } }>(
                                    `/api/coach/assistant/detections/${encodeURIComponent(detail.id)}/apply-plan`,
                                    {
                                      method: 'POST',
                                      data: {
                                        recommendationId: recommendation.id,
                                        aggressiveness: 'standard',
                                      },
                                    }
                                  );
                                  const href = `/coach/athletes/${encodeURIComponent(detail.athleteId)}/ai-plan-builder?assistantProposalId=${encodeURIComponent(
                                    resp.proposal.id
                                  )}&assistantDetectionId=${encodeURIComponent(detail.id)}&focus=assistant`;
                                  setPlanReviewHref(href);
                                  setStatusText(`Plan proposal created: ${resp.proposal.id}. Review and apply in AI Plan Builder.`);
                                } catch (err) {
                                  if (err instanceof ApiClientError && err.code === 'AI_PLAN_DRAFT_REQUIRED') {
                                    const href = `/coach/athletes/${encodeURIComponent(detail.athleteId)}/ai-plan-builder?focus=assistant`;
                                    setPlanReviewHref(href);
                                    setStatusText('No AI draft plan exists yet for this athlete. Open AI Plan Builder and generate weekly structure first.');
                                    return;
                                  }
                                  throw err;
                                }
                              })
                            }
                          >
                            {busyAction === 'apply-plan' ? 'Applying…' : 'Apply to plan'}
                          </Button>

                          <Button
                            variant="ghost"
                            disabled={Boolean(busyAction)}
                            onClick={() =>
                              void runAction('draft-message', async () => {
                                const resp = await request<{ draft: { message: string } }>(
                                  `/api/coach/assistant/detections/${encodeURIComponent(detail.id)}/draft-message`,
                                  {
                                    method: 'POST',
                                    data: {
                                      recommendationId: recommendation.id,
                                      tone: messageTone,
                                      includeEvidence,
                                    },
                                  }
                                );
                                setMessageDraft(resp.draft.message);
                                setStatusText('Message draft refreshed.');
                              })
                            }
                          >
                            {busyAction === 'draft-message' ? 'Drafting…' : 'Draft message'}
                          </Button>

                          <Button
                            variant="ghost"
                            disabled={Boolean(busyAction)}
                            onClick={() =>
                              void runAction('discuss', async () => {
                                const resp = await request<{ entrypoint: string }>(
                                  `/api/coach/assistant/detections/${encodeURIComponent(detail.id)}/discuss`,
                                  {
                                    method: 'POST',
                                  }
                                );
                                setStatusText(`Discuss context prepared: ${resp.entrypoint}`);
                              })
                            }
                          >
                            {busyAction === 'discuss' ? 'Preparing…' : 'Discuss in chat'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={tokens.typography.sectionLabel}>Message composer</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <SelectField
                      value={messageTone}
                      onChange={(event) => setMessageTone(event.target.value as typeof messageTone)}
                    >
                      <option value="direct">Direct</option>
                      <option value="encouraging">Encouraging</option>
                      <option value="matter_of_fact">Matter-of-fact</option>
                    </SelectField>
                    <button
                      type="button"
                      onClick={() => setIncludeEvidence((value) => !value)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left text-sm',
                        includeEvidence
                          ? 'border-[var(--ring)] bg-[var(--bg-structure)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-card)]'
                      )}
                    >
                      Include evidence: {includeEvidence ? 'On' : 'Off'}
                    </button>
                    <Button
                      variant="secondary"
                      disabled={Boolean(busyAction) || !messageDraft.trim()}
                      onClick={() =>
                        void runAction('send-message', async () => {
                          const recommendationId = detail.recommendations[0]?.id;
                          await request(`/api/coach/assistant/detections/${encodeURIComponent(detail.id)}/send-message`, {
                            method: 'POST',
                            data: {
                              message: messageDraft,
                              recommendationId,
                            },
                          });
                          setStatusText('Message sent to athlete thread.');
                        })
                      }
                    >
                      {busyAction === 'send-message' ? 'Sending…' : 'Send to athlete'}
                    </Button>
                  </div>
                  <Textarea
                    rows={5}
                    className="mt-2"
                    placeholder="Draft message appears here"
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                  />
                </div>

                <div>
                  <p className={tokens.typography.sectionLabel}>Coach control</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <Button
                      variant="ghost"
                      disabled={Boolean(busyAction)}
                      onClick={() =>
                        void runAction('snooze', async () => {
                          await request(`/api/coach/assistant/detections/${encodeURIComponent(detail.id)}/snooze`, {
                            method: 'POST',
                            data: { days: 7 },
                          });
                          setStatusText('Detection snoozed for 7 days.');
                        })
                      }
                    >
                      Snooze 7d
                    </Button>

                    <Button
                      variant="ghost"
                      disabled={Boolean(busyAction)}
                      onClick={() =>
                        void runAction('actioned', async () => {
                          await request(`/api/coach/assistant/detections/${encodeURIComponent(detail.id)}/mark-actioned`, {
                            method: 'POST',
                          });
                          setStatusText('Detection marked actioned.');
                        })
                      }
                    >
                      Mark actioned
                    </Button>

                    <Button
                      variant="danger"
                      disabled={Boolean(busyAction) || !dismissReason.trim()}
                      onClick={() =>
                        void runAction('dismiss', async () => {
                          await request(`/api/coach/assistant/detections/${encodeURIComponent(detail.id)}/dismiss`, {
                            method: 'POST',
                            data: { reason: dismissReason },
                          });
                          setStatusText('Detection dismissed.');
                        })
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                  <Textarea
                    rows={2}
                    className="mt-2"
                    placeholder="Dismiss reason"
                    value={dismissReason}
                    onChange={(event) => setDismissReason(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </Block>
        </div>
      </div>

      {statusText ? <p className={cn('rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700', tokens.typography.body)}>{statusText}</p> : null}
      {planReviewHref ? (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => router.push(planReviewHref as any)}>
            Open In AI Plan Builder
          </Button>
        </div>
      ) : null}
      {error ? <p className={cn('rounded-xl bg-rose-50 px-3 py-2 text-rose-700', tokens.typography.body)}>{error}</p> : null}
    </section>
  );
}
