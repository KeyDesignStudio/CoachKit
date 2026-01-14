'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { uiH1 } from '@/components/ui/typography';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { cn } from '@/lib/cn';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30';

type AthleteDashboardResponse = {
  kpis: {
    workoutsCompleted: number;
    workoutsSkipped: number;
    totalTrainingMinutes: number;
    totalDistanceKm: number;
  };
  attention: {
    pendingConfirmation: number;
    workoutsMissed: number;
    painFlagWorkouts?: number;
  };
  disciplineLoad: Array<{ discipline: string; totalMinutes: number; totalDistanceKm: number }>;
};

type AthleteThreadSummary = {
  threadId: string;
  lastMessagePreview: string;
  lastMessageAt: string | null;
};

type ThreadMessagesResponse = {
  threadId: string;
  messages: Array<{
    id: string;
    body: string;
    createdAt: string;
    senderRole: 'COACH' | 'ATHLETE';
    senderUserId: string;
  }>;
};

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDistanceKm(km: number): string {
  const value = Number.isFinite(km) ? km : 0;
  if (value === 0) return '0 km';
  if (value < 10) return `${value.toFixed(1)} km`;
  return `${Math.round(value)} km`;
}

function getDisciplineTheme(discipline: string) {
  const key = (discipline || '').toUpperCase();
  if (key === 'BIKE') return { label: 'Bike', bar: 'bg-blue-500/70' };
  if (key === 'RUN') return { label: 'Run', bar: 'bg-emerald-500/70' };
  if (key === 'SWIM') return { label: 'Swim', bar: 'bg-cyan-500/70' };
  return { label: 'Other', bar: 'bg-zinc-500/60' };
}

function getDateRangeFromPreset(preset: TimeRangePreset, athleteTimeZone: string) {
  const todayKey = getZonedDateKeyForNow(athleteTimeZone);
  const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);
  const days = preset === 'LAST_14' ? 14 : preset === 'LAST_30' ? 30 : 7;
  const from = toDateInput(addDays(todayUtcMidnight, -(days - 1)));
  const to = toDateInput(todayUtcMidnight);
  return { from, to };
}

export default function AthleteDashboardConsolePage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const athleteDisplayName = user?.name ?? 'You';

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_7');
  const [discipline, setDiscipline] = useState<string | null>(null);

  const [data, setData] = useState<AthleteDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessagesResponse['messages']>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [messageStatus, setMessageStatus] = useState('');
  const [messageError, setMessageError] = useState('');

  const athleteTimeZone = user?.timezone ?? 'UTC';
  const dateRange = useMemo(() => getDateRangeFromPreset(timeRange, athleteTimeZone), [timeRange, athleteTimeZone]);

  const reload = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      setLoading(true);
      setError('');

      const qs = new URLSearchParams();
      qs.set('from', dateRange.from);
      qs.set('to', dateRange.to);
      if (discipline) qs.set('discipline', discipline);
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<AthleteDashboardResponse>(
          `/api/athlete/dashboard/console?${qs.toString()}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setData(resp);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [dateRange.from, dateRange.to, discipline, request, user?.role, user?.userId]
  );

  const loadThread = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      setThreadsLoading(true);
      setMessageError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<AthleteThreadSummary[]>(
          `/api/messages/threads${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setThreadId(resp[0]?.threadId ?? null);
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to load messages.');
      } finally {
        setThreadsLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  const loadMessages = useCallback(
    async (tid: string, bypassCache = false) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      setMessagesLoading(true);
      setMessageError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<ThreadMessagesResponse>(
          `/api/messages/threads/${tid}${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setMessages(resp.messages);
        await request('/api/messages/mark-read', { method: 'POST', data: { threadId: tid } });
        void loadThread();
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to load messages.');
      } finally {
        setMessagesLoading(false);
      }
    },
    [loadThread, request, user?.role, user?.userId]
  );

  const sendMessage = useCallback(async () => {
    const body = messageDraft.trim();
    if (!body) return;
    if (!user?.userId || user.role !== 'ATHLETE') return;

    setMessageSending(true);
    setMessageStatus('');
    setMessageError('');

    try {
      const resp = await request<{ sent: number; threadIds: string[] }>('/api/messages/send', {
        method: 'POST',
        data: { body },
      });

      setMessageDraft('');
      setMessageStatus('Sent.');

      const tid = resp.threadIds[0] ?? threadId;
      if (tid) {
        setThreadId(tid);
        void loadMessages(tid, true);
      } else {
        void loadThread(true);
      }
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setMessageSending(false);
    }
  }, [loadMessages, loadThread, messageDraft, request, threadId, user?.role, user?.userId]);

  useEffect(() => {
    if (user?.role === 'ATHLETE') {
      void reload();
    }
  }, [reload, user?.role]);

  useEffect(() => {
    if (user?.role === 'ATHLETE') {
      void loadThread();
    }
  }, [loadThread, user?.role]);

  useEffect(() => {
    if (threadId) {
      void loadMessages(threadId);
    } else {
      setMessages([]);
    }
  }, [loadMessages, threadId]);

  if (userLoading) {
    return (
      <section className="px-4 pb-10 md:px-6">
        <div className="pt-3 md:pt-6">
          <h1 className={cn(uiH1, 'font-semibold')}>Athlete Console</h1>
        </div>
        <div className="mt-6 text-sm text-[var(--muted)]">Loading…</div>
      </section>
    );
  }

  if (!user || user.role !== 'ATHLETE') {
    return (
      <section className="px-4 pb-10 md:px-6">
        <div className="pt-3 md:pt-6">
          <h1 className={cn(uiH1, 'font-semibold')}>Athlete Console</h1>
        </div>
        <div className="mt-6 text-sm text-[var(--muted)]">Athlete access required.</div>
      </section>
    );
  }

  return (
    <>
      <section className="px-4 pb-10 md:px-6">
        <div className="pt-3 md:pt-6">
          <h1 className={cn(uiH1, 'font-semibold')}>Athlete Console</h1>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
          {/* Needs your attention (mobile #1; desktop col 2) */}
          <div className="min-w-0 order-1 lg:order-2">
            <div className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
              <div className="flex items-end justify-between gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--text)]">Needs your attention</h2>
                <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
              </div>

              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => (window.location.href = '/athlete/calendar')}
                  className={cn(
                    'w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left',
                    'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--text)]">Workouts pending your confirmation</div>
                      <div className="text-xs text-[var(--muted)]">Open your calendar to confirm</div>
                    </div>
                    <div className="tabular-nums text-lg font-semibold text-[var(--text)]">
                      {String(data?.attention.pendingConfirmation ?? 0)}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => (window.location.href = '/athlete/calendar')}
                  className={cn(
                    'w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left',
                    'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--text)]">Workouts missed</div>
                      <div className="text-xs text-[var(--muted)]">Past days with no completion</div>
                    </div>
                    <div className="tabular-nums text-lg font-semibold text-[var(--text)]">
                      {String(data?.attention.workoutsMissed ?? 0)}
                    </div>
                  </div>
                </button>

                {typeof data?.attention.painFlagWorkouts === 'number' ? (
                  <button
                    type="button"
                    onClick={() => (window.location.href = '/athlete/calendar')}
                    className={cn(
                      'w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left',
                      'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text)]">Workouts with pain flagged</div>
                        <div className="text-xs text-[var(--muted)]">Completed workouts reporting pain</div>
                      </div>
                      <div className="tabular-nums text-lg font-semibold text-[var(--text)]">
                        {String(data.attention.painFlagWorkouts)}
                      </div>
                    </div>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* At a glance (mobile #2; desktop col 3) */}
          <div className="min-w-0 order-2 lg:order-3">
            <div className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4" data-testid="athlete-dashboard-at-a-glance">
              <div className="flex items-end justify-between gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--text)]">At a glance</h2>
                <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-x-6 gap-y-4 md:gap-x-10 md:gap-y-6" data-testid="athlete-dashboard-at-a-glance-grid">
                {[
                  { label: 'Workouts completed', value: String(data?.kpis.workoutsCompleted ?? 0) },
                  { label: 'Workouts skipped', value: String(data?.kpis.workoutsSkipped ?? 0) },
                  { label: 'Total training time', value: formatMinutes(data?.kpis.totalTrainingMinutes ?? 0) },
                  { label: 'Total distance', value: formatDistanceKm(data?.kpis.totalDistanceKm ?? 0) },
                ].map((tile) => (
                  <div key={tile.label} className="min-w-0 rounded-2xl bg-[var(--bg-structure)]/50 px-3 py-2">
                    <div className="text-[22px] min-[420px]:text-[24px] lg:text-[26px] leading-[1.05] font-semibold tabular-nums text-[var(--text)]">
                      {tile.value}
                    </div>
                    <div className="min-w-0 text-[10px] md:text-[11px] leading-snug uppercase tracking-wide text-[var(--muted)]/90 whitespace-nowrap overflow-hidden text-ellipsis" title={tile.label}>
                      {tile.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Filters (mobile #3; desktop col 1) */}
          <div className="min-w-0 order-3 lg:order-1">
            <div className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
              <div className="flex items-end justify-between gap-3 mb-4">
                <h2 className="text-sm font-semibold text-[var(--text)]">Filters</h2>
                <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Time range</div>
                  <Select className="min-h-[44px]" value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRangePreset)}>
                    <option value="LAST_7">Last 7 days</option>
                    <option value="LAST_14">Last 14 days</option>
                    <option value="LAST_30">Last 30 days</option>
                  </Select>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Discipline</div>
                  <Select className="min-h-[44px]" value={discipline ?? ''} onChange={(e) => setDiscipline(e.target.value ? e.target.value : null)}>
                    <option value="">All disciplines</option>
                    <option value="BIKE">Bike</option>
                    <option value="RUN">Run</option>
                    <option value="SWIM">Swim</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </div>

                <div className="min-h-[44px] flex items-center">
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {formatDisplayInTimeZone(dateRange.from, athleteTimeZone)} → {formatDisplayInTimeZone(dateRange.to, athleteTimeZone)}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={() => reload(true)} className="min-h-[44px]">
                    <Icon name="refresh" size="sm" className="mr-1" aria-hidden />
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm">{error}</div> : null}
        {loading ? <div className="mt-4 text-sm text-[var(--muted)]">Loading…</div> : null}

        {/* Discipline load (mobile #4) */}
        <div className="mt-10 min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text)] mb-2 pl-3 md:pl-4">Discipline load</h2>
          <div className="rounded-2xl bg-[var(--bg-card)] p-3">
            {(() => {
              const rows = data?.disciplineLoad ?? [];
              const maxMinutes = Math.max(1, ...rows.map((r) => r.totalMinutes));
              return (
                <div className="flex flex-col gap-2">
                  {rows.map((r) => {
                    const theme = getDisciplineTheme(r.discipline);
                    const pct = Math.max(0, Math.min(1, r.totalMinutes / maxMinutes));
                    return (
                      <div key={r.discipline} className="rounded-2xl border border-black/5 bg-[var(--bg-surface)] px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-[var(--text)]">{theme.label}</div>
                          <div className="text-xs text-[var(--muted)] tabular-nums">
                            {formatMinutes(r.totalMinutes)} · {formatDistanceKm(r.totalDistanceKm)}
                          </div>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/5">
                          <div className={cn('h-full rounded-full', theme.bar)} style={{ width: `${Math.round(pct * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {rows.length === 0 ? <div className="text-sm text-[var(--muted)] px-1 py-2">No data for this range.</div> : null}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Messages (mobile #5) */}
        <div className="mt-10 min-w-0" data-testid="athlete-dashboard-messages">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2 pl-3 md:pl-4">
            <h2 className="text-sm font-semibold text-[var(--text)]">Messages</h2>
          </div>

          <div className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
            <div className="text-xs font-medium text-[var(--muted)]">Message your coach</div>

            <div className="mt-2 grid gap-2" data-testid="athlete-dashboard-messages-compose">
              <Textarea
                rows={3}
                placeholder="Write a message…"
                className="text-sm"
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                disabled={messageSending}
              />
              <div className="flex items-center justify-end gap-2">
                <Button type="button" className="min-h-[44px]" onClick={sendMessage} disabled={messageSending || messageDraft.trim().length === 0}>
                  {messageSending ? 'Sending…' : 'Send'}
                </Button>
              </div>
              {messageStatus ? <div className="text-xs text-emerald-700">{messageStatus}</div> : null}
              {messageError ? <div className="text-xs text-rose-700">{messageError}</div> : null}
            </div>

            <Card className="mt-4 rounded-2xl bg-[var(--bg-surface)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--muted)]">
                  {threadsLoading ? 'Loading thread…' : threadId ? 'Thread' : 'No messages yet'}
                </div>
                {threadId ? (
                  <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => loadMessages(threadId, true)}>
                    <Icon name="refresh" size="sm" className="mr-1" aria-hidden />
                    Refresh
                  </Button>
                ) : null}
              </div>

              {messagesLoading ? <div className="mt-3 text-sm text-[var(--muted)]">Loading messages…</div> : null}
              {!messagesLoading && threadId && messages.length === 0 ? (
                <div className="mt-3 text-sm text-[var(--muted)]">No messages yet.</div>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {messages.map((m) => {
                  const mine = m.senderRole === 'ATHLETE';
                  const senderLabel = mine ? athleteDisplayName : 'COACH';
                  return (
                    <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[min(560px,92%)] rounded-2xl px-3 py-2 border',
                          mine
                            ? 'bg-[var(--bg-card)] border-[var(--border-subtle)]'
                            : 'bg-[var(--bg-structure)] border-black/10'
                        )}
                      >
                        <div className="text-sm whitespace-pre-wrap text-[var(--text)]">{m.body}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                          {senderLabel} · {new Date(m.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
}
