/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import type { PlanReasoningV1 } from '@/lib/ai/plan-reasoning/types';
import type { Dispatch, SetStateAction } from 'react';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

import { addDaysToDayKey, isDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';
import { renderWorkoutDetailFromSessionDetailV1 } from '@/lib/workoutDetailRenderer';

import { DAY_NAMES_SUN0, dayOffsetFromWeekStart } from '../lib/week-start';
import { sessionDetailV1Schema } from '../rules/session-detail';

type ReviewPlanSetup = {
  startDate: string;
  completionDate: string;
};

type SessionDraftEdits = Record<
  string,
  {
    durationMinutes?: string;
    notes?: string;
    discipline?: string;
    type?: string;
    objective?: string;
    blockSteps?: Record<number, string>;
  }
>;

type ReviewPlanProps = {
  hasDraft: boolean;
  planReasoning: PlanReasoningV1 | null;
  sessionsByWeek: Array<[number, any[]]>;
  sessionsByWeekMap: Map<number, any[]>;
  sessionDraftEdits: SessionDraftEdits;
  weekLockedByIndex: Map<number, boolean>;
  setup: ReviewPlanSetup;
  effectiveWeekStart: 'monday' | 'sunday';
  effectiveWeeksToCompletion: number;
  busy: string | null;
  setSessionDraftEdits: Dispatch<SetStateAction<SessionDraftEdits>>;
  saveSessionEdit: (sessionId: string) => void;
  toggleSessionLock: (sessionId: string, locked: boolean) => void;
  toggleWeekLock: (weekIndex: number, locked: boolean) => void;
  sessionDetailsById: Record<string, { detailJson: any | null; loading: boolean; error?: string | null }>;
  loadSessionDetail: (sessionId: string) => void;
};

function isIntensitySessionType(type: string): boolean {
  const t = String(type || '').toLowerCase();
  return t.includes('tempo') || t.includes('threshold') || t.includes('interval') || t.includes('vo2') || t.includes('speed') || t.includes('hill');
}

function formatWeekIntentLabel(intent: string): string {
  const map: Record<string, string> = {
    build: 'Build',
    consolidate: 'Consolidation',
    deload: 'Recovery',
    taper: 'Taper',
    race: 'Race',
  };
  return map[intent] ?? intent;
}

function summarizeWeekDelta(deltaPct: number): string {
  if (!Number.isFinite(deltaPct)) return 'Focus on consistency.';
  if (deltaPct >= 8) return 'Increase from last week, focusing on building load.';
  if (deltaPct >= 2) return 'Slight increase from last week, focusing on consistency.';
  if (deltaPct <= -8) return 'Reduced for recovery and freshness.';
  if (deltaPct <= -2) return 'Slight reduction for recovery.';
  return 'Similar volume to last week, focusing on consistency.';
}

function deriveDisciplineBalance(split: Record<string, number | undefined>): string {
  const entries = Object.entries(split).filter(([, v]) => typeof v === 'number' && (v as number) > 0) as Array<[string, number]>;
  if (!entries.length) return 'Balanced';
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total <= 0) return 'Balanced';
  const [topKey, topVal] = entries.sort((a, b) => b[1] - a[1])[0];
  const pct = topVal / total;
  if (pct >= 0.55) return `${topKey[0].toUpperCase() + topKey.slice(1)}-heavy`;
  return 'Balanced';
}

type WeekSummaryProps = {
  week: PlanReasoningV1['weeks'][number];
  weekSessions: any[];
};

function WeekSummaryCard({ week, weekSessions }: WeekSummaryProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { totalSessions, keySessions, longSessionLabel, balance, splitEntries } = useMemo(() => {
    const total = weekSessions.length;
    const key = weekSessions.filter((s) => isIntensitySessionType(String(s.type ?? ''))).length;
    const longSession = weekSessions.reduce(
      (acc, s) => (Number(s.durationMinutes ?? 0) > Number(acc?.durationMinutes ?? 0) ? s : acc),
      null as any
    );
    const longLabel = longSession
      ? `${String(longSession.discipline ?? '').toLowerCase()} · ${DAY_NAMES_SUN0[Number(longSession.dayOfWeek ?? 0)] ?? 'Day'}`
      : '—';
    const disciplineBalance = deriveDisciplineBalance(week.disciplineSplitMinutes ?? {});
    const split = Object.entries(week.disciplineSplitMinutes)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => `${k}: ${v}m`)
      .join(', ');

    return {
      totalSessions: total,
      keySessions: key,
      longSessionLabel: longLabel,
      balance: disciplineBalance,
      splitEntries: split,
    };
  }, [weekSessions, week.disciplineSplitMinutes]);

  return (
    <div
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2"
      data-testid={`apb-week-summary-${week.weekIndex}`}
    >
      <div className="text-xs font-medium">Week {week.weekIndex + 1} — {formatWeekIntentLabel(week.weekIntent)}</div>
      <div className="mt-1 text-xs text-[var(--fg-muted)]">
        {summarizeWeekDelta(week.volumeDeltaPct)}
      </div>
      <div className="mt-1 text-xs text-[var(--fg-muted)]">
        Sessions: {totalSessions} total • Key sessions: {keySessions} • Long session: {longSessionLabel}
      </div>
      <div className="mt-1 text-xs text-[var(--fg-muted)]">Discipline balance: {balance}</div>
      <details
        className="mt-2 text-xs text-[var(--fg-muted)]"
        onToggle={(event) => setDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer">Show details</summary>
        {detailsOpen ? (
          <div className="mt-1 space-y-1">
            <div>
              Volume: {week.volumeMinutesPlanned}m{week.volumeDeltaPct ? ` (${week.volumeDeltaPct >= 0 ? '+' : ''}${week.volumeDeltaPct}%)` : ''}
            </div>
            <div>Split: {splitEntries || '—'}</div>
          </div>
        ) : null}
      </details>
    </div>
  );
}

function startOfWeekDayKeyWithWeekStart(dayKey: string, weekStart: 'monday' | 'sunday'): string {
  if (!isDayKey(dayKey)) return dayKey;
  const date = parseDayKeyToUtcDate(dayKey);
  const jsDay = date.getUTCDay();
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  return addDaysToDayKey(dayKey, -diff);
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

function deriveWeekCommencingDayKey(params: {
  weekIndex: number;
  startDate: string;
  completionDate: string;
  weekStart: 'monday' | 'sunday';
  effectiveWeeksToCompletion: number;
}): string {
  const { weekIndex, startDate, completionDate, weekStart, effectiveWeeksToCompletion } = params;

  if (isDayKey(startDate)) {
    const week0 = startOfWeekDayKeyWithWeekStart(startDate, weekStart);
    return addDaysToDayKey(week0, 7 * weekIndex);
  }

  if (isDayKey(completionDate)) {
    const completionWeekStart = startOfWeekDayKeyWithWeekStart(completionDate, weekStart);
    const remainingWeeks = Math.max(1, effectiveWeeksToCompletion) - 1 - weekIndex;
    return addDaysToDayKey(completionWeekStart, -7 * remainingWeeks);
  }

  return '';
}

type SessionPresentation = {
  objective: string | null;
  blocks: any[];
  workoutDetailPreview: string | null;
  dayLabel: string;
};

export function AiPlanBuilderReviewPlanSection({
  hasDraft,
  planReasoning,
  sessionsByWeek,
  sessionsByWeekMap,
  sessionDraftEdits,
  weekLockedByIndex,
  setup,
  effectiveWeekStart,
  effectiveWeeksToCompletion,
  busy,
  setSessionDraftEdits,
  saveSessionEdit,
  toggleSessionLock,
  toggleWeekLock,
  sessionDetailsById,
  loadSessionDetail,
}: ReviewPlanProps) {
  const disciplineOptions = ['RUN', 'BIKE', 'SWIM', 'STRENGTH', 'OTHER'] as const;

  const weekCommencingByIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const [weekIndex] of sessionsByWeek) {
      const wIdx = Number(weekIndex);
      map.set(
        wIdx,
        deriveWeekCommencingDayKey({
          weekIndex: wIdx,
          startDate: setup.startDate,
          completionDate: setup.completionDate,
          weekStart: effectiveWeekStart,
          effectiveWeeksToCompletion,
        })
      );
    }
    return map;
  }, [sessionsByWeek, setup.startDate, setup.completionDate, effectiveWeekStart, effectiveWeeksToCompletion]);

  const sessionPresentationById = useMemo(() => {
    const map = new Map<string, SessionPresentation>();

    for (const [weekIndex, sessions] of sessionsByWeek) {
      const weekCommencingDayKey = weekCommencingByIndex.get(Number(weekIndex)) ?? '';

      for (const s of sessions) {
        const sessionId = String(s.id);
        const lazyDetail = sessionDetailsById[String(s.id)]?.detailJson;
        const detailParsed = sessionDetailV1Schema.safeParse(lazyDetail ?? (s as any)?.detailJson ?? null);
        const objective = detailParsed.success ? detailParsed.data.objective : null;
        const blocks = detailParsed.success ? detailParsed.data.structure : [];
        const workoutDetailPreview = detailParsed.success
          ? renderWorkoutDetailFromSessionDetailV1(detailParsed.data)
          : null;

        const sessionDayKey = weekCommencingDayKey
          ? addDaysToDayKey(weekCommencingDayKey, dayOffsetFromWeekStart(Number(s.dayOfWeek) ?? 0, effectiveWeekStart))
          : '';

        map.set(sessionId, {
          objective,
          blocks,
          workoutDetailPreview,
          dayLabel: sessionDayKey ? formatDayKeyShort(sessionDayKey) : DAY_NAMES_SUN0[Number(s.dayOfWeek) ?? 0],
        });
      }
    }

    return map;
  }, [sessionsByWeek, weekCommencingByIndex, effectiveWeekStart]);

  return !hasDraft ? (
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
                  const weekSessions = sessionsByWeekMap.get(week.weekIndex) ?? [];
                  return (
                    <WeekSummaryCard
                      key={week.weekIndex}
                      week={week}
                      weekSessions={weekSessions}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {sessionsByWeek.map(([weekIndex, sessions]) => {
        const weekIndexNumber = Number(weekIndex);
        const weekLocked = weekLockedByIndex.get(weekIndexNumber) ?? false;
        const weekCommencingDayKey = weekCommencingByIndex.get(weekIndexNumber) ?? '';

        return (
          <div key={weekIndex} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3" data-testid="apb-week">
            <div className="mb-3 flex items-center justify-between" data-testid="apb-week-header">
              <div className="text-sm font-semibold" data-testid="apb-week-heading">
                Week {weekIndexNumber + 1}{' '}
                {weekCommencingDayKey ? (
                  <span className="font-normal text-[var(--fg-muted)]" data-testid="apb-week-commencing">
                    • Commencing {formatDayKeyShort(weekCommencingDayKey)}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant={weekLocked ? 'primary' : 'secondary'}
                disabled={busy != null}
                data-testid="apb-week-lock-toggle"
                onClick={() => toggleWeekLock(weekIndexNumber, !weekLocked)}
              >
                {busy === `lock-week:${weekIndexNumber}` ? 'Updating…' : weekLocked ? 'Unlock week' : 'Lock week'}
              </Button>
            </div>

          <div className="space-y-3">
            {sessions.map((s) => {
              const sessionId = String(s.id);
              const edit = sessionDraftEdits[sessionId] ?? {};
              const presentation = sessionPresentationById.get(sessionId);
              const detailState = sessionDetailsById[sessionId];
              const blocks = presentation?.blocks ?? [];
              const workoutDetailPreview = presentation?.workoutDetailPreview ?? null;
              const dayLabel = presentation?.dayLabel ?? (DAY_NAMES_SUN0[Number(s.dayOfWeek) ?? 0] ?? 'Day');
              const objective = presentation?.objective ?? null;
              const hasDetail = Boolean(detailState?.detailJson ?? (s as any)?.detailJson);

              const sessionLocked = Boolean((s as any)?.locked);
              const locked = weekLocked || sessionLocked;

              const currentDisciplineRaw = String(edit.discipline ?? (s as any)?.discipline ?? '').trim().toUpperCase();
              const selectedDiscipline = currentDisciplineRaw || disciplineOptions[0];
              const disciplineChoices = Array.from(new Set([selectedDiscipline, ...disciplineOptions]));

              return (
                <div
                  key={sessionId}
                  className={`rounded-md border border-[var(--border-subtle)] bg-[var(--bg)] px-3 py-3 ${locked ? 'opacity-80' : ''}`}
                  data-testid="apb-session"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium" data-testid="apb-session-day">
                      {dayLabel}
                      {locked ? (
                        <span className="ml-2 rounded bg-[var(--bg-structure)] px-2 py-0.5 text-xs text-[var(--fg-muted)]">Locked</span>
                      ) : null}
                    </div>
                  </div>

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

                  {!hasDetail ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy != null || Boolean(detailState?.loading)}
                        data-testid="apb-session-load-detail"
                        onClick={() => loadSessionDetail(sessionId)}
                      >
                        {detailState?.loading ? 'Loading details…' : 'Load session details'}
                      </Button>
                      {detailState?.error ? (
                        <div className="mt-2 text-xs text-red-700">{detailState.error}</div>
                      ) : (
                        <div className="mt-2 text-xs text-[var(--fg-muted)]">
                          Session details are generated lazily to improve initial load speed.
                        </div>
                      )}
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
        );
      })}
    </div>
  );
}
