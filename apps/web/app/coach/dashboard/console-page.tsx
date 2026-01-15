'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { ReviewDrawer } from '@/components/coach/ReviewDrawer';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { uiH1, uiMuted } from '@/components/ui/typography';
import { addDays, formatDisplayInTimeZone, toDateInput } from '@/lib/client-date';
import { cn } from '@/lib/cn';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';

type TimeRangePreset = 'LAST_7' | 'LAST_14' | 'LAST_30' | 'CUSTOM';
type InboxPreset = 'ALL' | 'PAIN' | 'COMMENTS' | 'SKIPPED' | 'AWAITING_REVIEW';

type DashboardAthlete = {
  id: string;
  name: string | null;
  disciplines: string[];
};

type ReviewItem = {
  id: string;
  title: string;
  date: string;
  actionAt: string;
  discipline: string;
  plannedStartTimeLocal: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  workoutDetail: string | null;
  status: string;
  latestCompletedActivity: {
    id: string;
    durationMinutes: number | null;
    distanceKm: number | null;
    rpe: number | null;
    painFlag: boolean;
    startTime: string;
  } | null;
  athlete: {
    id: string;
    name: string | null;
  } | null;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: {
      id: string;
      name: string | null;
      role: 'COACH' | 'ATHLETE';
    };
  }>;
  hasAthleteComment: boolean;
  commentCount: number;
};

type DashboardResponse = {
  athletes: DashboardAthlete[];
  kpis: {
    workoutsCompleted: number;
    workoutsSkipped: number;
    totalTrainingMinutes: number;
    totalDistanceKm: number;
  };
  attention: {
    painFlagWorkouts: number;
    athleteCommentWorkouts: number;
    skippedWorkouts: number;
    awaitingCoachReview: number;
  };
  disciplineLoad: Array<{ discipline: string; totalMinutes: number; totalDistanceKm: number }>;
  reviewInbox: ReviewItem[];
};

type MessageThreadSummary = {
  threadId: string;
  athlete: { id: string; name: string | null };
  lastMessagePreview: string;
  lastMessageAt: string | null;
  unreadCountForCoach: number;
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
  if (value === 0) return '0km';
  if (value < 10) return `${value.toFixed(1)}km`;
  return `${Math.round(value)}km`;
}

function formatCalendarDayLabel(dateIso: string, timeZone: string): string {
  return formatDisplayInTimeZone(dateIso, timeZone);
}

function getDateRangeFromPreset(preset: TimeRangePreset, coachTimeZone: string, customFrom: string, customTo: string) {
  const todayKey = getZonedDateKeyForNow(coachTimeZone);
  const todayUtcMidnight = new Date(`${todayKey}T00:00:00.000Z`);

  if (preset === 'CUSTOM') {
    return { from: customFrom || todayKey, to: customTo || todayKey };
  }

  const days = preset === 'LAST_14' ? 14 : preset === 'LAST_30' ? 30 : 7;
  const from = toDateInput(addDays(todayUtcMidnight, -(days - 1)));
  const to = toDateInput(todayUtcMidnight);
  return { from, to };
}

function AttentionItem({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: 'danger' | 'primary' | 'neutral';
  active: boolean;
  onClick: () => void;
}) {
  const toneClasses =
    tone === 'danger'
      ? 'bg-rose-500/15 text-rose-700'
      : tone === 'primary'
        ? 'bg-blue-600/10 text-blue-700'
        : 'bg-[var(--bg-card)] text-[var(--text)]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl px-4 py-3 text-left min-h-[56px]',
        'transition-colors',
        active ? 'ring-2 ring-[var(--ring)]' : 'hover:bg-white/60',
        toneClasses
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium">{label}</div>
        <div className={cn('text-2xl font-semibold tabular-nums', tone === 'danger' ? 'text-rose-700' : '')}>{count}</div>
      </div>
    </button>
  );
}

function AlertStripItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl px-4 py-3 text-left min-h-[56px]',
        'bg-[var(--bg-card)] border border-black/15 transition-colors',
        active ? 'ring-2 ring-[var(--ring)]' : 'hover:bg-white/60'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--text)]">{label}</div>
        <div className="text-2xl font-semibold tabular-nums text-[var(--text)]">{count}</div>
      </div>
    </button>
  );
}

function ReviewInboxRow({
  item,
  isChecked,
  onToggleSelected,
  onOpen,
}: {
  item: ReviewItem;
  isChecked: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onOpen: (item: ReviewItem) => void;
}) {
  const theme = getDisciplineTheme(item.discipline);
  const athleteName = item.athlete?.name ?? 'Unknown athlete';
  const disciplineLabel = (item.discipline || 'OTHER').toUpperCase();
  const painFlag = item.latestCompletedActivity?.painFlag ?? false;
  const isSkipped = item.status === 'SKIPPED';

  const statusText = item.status
    .replace('COMPLETED_', 'COMPLETED ')
    .replace(/_/g, ' ')
    .trim();

  return (
    <div className="flex items-center gap-2 px-3 py-2 min-w-0">
      <label className="h-11 w-11 flex items-center justify-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blue-600"
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelected(item.id, e.target.checked);
          }}
          aria-label={`Select ${athleteName} - ${item.title}`}
        />
      </label>

      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          'flex items-center gap-2 min-w-0 flex-1 text-left justify-start min-h-[44px]',
          painFlag ? 'bg-rose-500/10 rounded-xl px-2 py-2 -mx-2' : ''
        )}
      >
        <span className="block min-w-0 max-w-[30%] truncate text-sm font-medium text-[var(--text)]">{athleteName}</span>
        <span className="block min-w-0 max-w-[45%] truncate text-sm text-[var(--text)]">{item.title}</span>

        <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
          <Icon name={theme.iconName} size="sm" className={theme.textClass} />
          <span className={cn('text-xs uppercase text-[var(--muted)] font-medium', theme.textClass)}>{disciplineLabel}</span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
          <span className={cn('text-xs uppercase', painFlag ? 'text-rose-700 font-medium' : 'text-[var(--muted)]')}>{statusText}</span>
          <div className="flex items-center gap-1">
            {item.hasAthleteComment ? <Icon name="athleteComment" size="xs" className="text-blue-600" aria-label="Has athlete comment" aria-hidden={false} /> : null}
            {painFlag ? <Icon name="painFlag" size="xs" className="text-rose-500" aria-label="Pain flagged" aria-hidden={false} /> : null}
            {isSkipped ? <Icon name="skipped" size="xs" className="text-[var(--muted)]" aria-label="Skipped" aria-hidden={false} /> : null}
          </div>
        </div>
      </button>
    </div>
  );
}

export default function CoachDashboardConsolePage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const [timeRange, setTimeRange] = useState<TimeRangePreset>('LAST_7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [inboxPreset, setInboxPreset] = useState<InboxPreset>('ALL');

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);

  const reviewInboxRef = useRef<HTMLDivElement | null>(null);

  const needsCardRef = useRef<HTMLDivElement | null>(null);
  const [xlTopCardHeightPx, setXlTopCardHeightPx] = useState<number | null>(null);

  const [messageThreads, setMessageThreads] = useState<MessageThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageAthleteId, setMessageAthleteId] = useState<string>('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessagesResponse['messages']>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [messageStatus, setMessageStatus] = useState('');
  const [messageError, setMessageError] = useState('');
  const [messageThreadFilter, setMessageThreadFilter] = useState('');

  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [messageDeleteLoading, setMessageDeleteLoading] = useState(false);

  const messagePollInFlightRef = useRef(false);

  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastAllAthletes, setBroadcastAllAthletes] = useState(false);
  const [broadcastSelectedAthleteIds, setBroadcastSelectedAthleteIds] = useState<Set<string>>(() => new Set());
  const [broadcastFilter, setBroadcastFilter] = useState('');
  const [broadcastDraft, setBroadcastDraft] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastError, setBroadcastError] = useState('');

  const coachTimeZone = user?.timezone ?? 'UTC';
  const dateRange = useMemo(() => getDateRangeFromPreset(timeRange, coachTimeZone, customFrom, customTo), [
    timeRange,
    coachTimeZone,
    customFrom,
    customTo,
  ]);

  const reload = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'COACH') return;

      setLoading(true);
      setError('');

      const qs = new URLSearchParams();
      qs.set('from', dateRange.from);
      qs.set('to', dateRange.to);
      if (athleteId) qs.set('athleteId', athleteId);
      if (discipline) qs.set('discipline', discipline);
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<DashboardResponse>(`/api/coach/dashboard/console?${qs.toString()}`, bypassCache ? { cache: 'no-store' } : undefined);
        setData(resp);
        setSelectedIds(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [athleteId, dateRange.from, dateRange.to, discipline, request, user?.role, user?.userId]
  );

  useEffect(() => {
    if (user?.role === 'COACH') {
      reload();
    }
  }, [reload, user?.role]);

  const threadIdByAthleteId = useMemo(() => {
    const map = new Map<string, string>();
    messageThreads.forEach((t) => map.set(t.athlete.id, t.threadId));
    return map;
  }, [messageThreads]);

  const sortedMessageThreads = useMemo(() => {
    const normalizedFilter = messageThreadFilter.trim().toLowerCase();
    const rows = [...messageThreads];
    rows.sort((a, b) => {
      const aUnread = a.unreadCountForCoach ?? 0;
      const bUnread = b.unreadCountForCoach ?? 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      const aAt = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bAt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      if (aAt !== bAt) return bAt - aAt;
      return (a.athlete.name ?? '').localeCompare(b.athlete.name ?? '');
    });

    if (!normalizedFilter) return rows;
    return rows.filter((t) => {
      const name = (t.athlete.name ?? 'Unnamed athlete').toLowerCase();
      const preview = (t.lastMessagePreview ?? '').toLowerCase();
      return name.includes(normalizedFilter) || preview.includes(normalizedFilter);
    });
  }, [messageThreadFilter, messageThreads]);

  const totalUnreadThreads = useMemo(() => {
    return messageThreads.reduce((sum, t) => sum + Math.max(0, t.unreadCountForCoach ?? 0), 0);
  }, [messageThreads]);

  const visibleThreadMessageIds = useMemo(() => threadMessages.map((m) => m.id), [threadMessages]);

  const selectedVisibleMessageCount = useMemo(() => {
    if (visibleThreadMessageIds.length === 0 || selectedMessageIds.size === 0) return 0;
    let count = 0;
    for (const id of visibleThreadMessageIds) {
      if (selectedMessageIds.has(id)) count += 1;
    }
    return count;
  }, [selectedMessageIds, visibleThreadMessageIds]);

  const allVisibleMessagesSelected = useMemo(() => {
    return visibleThreadMessageIds.length > 0 && selectedVisibleMessageCount === visibleThreadMessageIds.length;
  }, [selectedVisibleMessageCount, visibleThreadMessageIds.length]);

  const selectedAthleteNameForThread = useMemo(() => {
    if (!messageAthleteId) return 'Athlete';
    const fromThreads = messageThreads.find((t) => t.athlete.id === messageAthleteId)?.athlete.name;
    const fromData = (data?.athletes ?? []).find((a) => a.id === messageAthleteId)?.name;
    return fromThreads ?? fromData ?? 'Athlete';
  }, [data?.athletes, messageAthleteId, messageThreads]);

  const openBroadcast = useCallback(() => {
    setBroadcastError('');
    setBroadcastDraft('');
    setBroadcastFilter('');
    setBroadcastAllAthletes(false);
    setBroadcastSelectedAthleteIds(messageAthleteId ? new Set([messageAthleteId]) : new Set());
    setBroadcastOpen(true);
  }, [messageAthleteId]);

  const closeBroadcast = useCallback(() => {
    setBroadcastOpen(false);
    setBroadcastError('');
    setBroadcastSending(false);
  }, []);

  const loadMessageThreads = useCallback(
    async (bypassCache = false, opts?: { silent?: boolean }) => {
      if (!user?.userId || user.role !== 'COACH') return;

      if (!opts?.silent) setThreadsLoading(true);
      setMessageError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<MessageThreadSummary[]>(
          `/api/messages/threads${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setMessageThreads(resp);
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to load message threads.');
      } finally {
        if (!opts?.silent) setThreadsLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  const sendBroadcast = useCallback(async () => {
    if (broadcastSending) return;
    const body = broadcastDraft.trim();
    if (!body) return;

    const athleteIds = Array.from(broadcastSelectedAthleteIds);
    if (!broadcastAllAthletes && athleteIds.length === 0) return;

    setBroadcastSending(true);
    setBroadcastError('');
    setMessageStatus('');
    setMessageError('');

    try {
      const resp = await request<{ sent: number; threadIds: string[] }>('/api/messages/send', {
        method: 'POST',
        data: {
          body,
          recipients: broadcastAllAthletes ? { allAthletes: true } : { athleteIds },
        },
      });

      setMessageStatus(`Broadcast sent to ${resp.sent} athlete${resp.sent === 1 ? '' : 's'}.`);
      closeBroadcast();
      await loadMessageThreads(true);
    } catch (err) {
      setBroadcastError(err instanceof Error ? err.message : 'Failed to send broadcast message.');
    } finally {
      setBroadcastSending(false);
    }
  }, [broadcastAllAthletes, broadcastDraft, broadcastSelectedAthleteIds, broadcastSending, closeBroadcast, loadMessageThreads, request]);

  const loadThreadMessages = useCallback(
    async (threadId: string, bypassCache = false, opts?: { silent?: boolean }) => {
      if (!user?.userId || user.role !== 'COACH') return;

      if (!opts?.silent) setMessagesLoading(true);
      setMessageError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<ThreadMessagesResponse>(
          `/api/messages/threads/${threadId}${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setThreadMessages(resp.messages);
        await request('/api/messages/mark-read', { method: 'POST', data: { threadId } });
        // Avoid a refresh loop: refreshing threads changes `threadIdByAthleteId`, which can
        // retrigger message loading effects and cause UI flicker. Instead, update local
        // unread count optimistically.
        setMessageThreads((prev) =>
          prev.map((t) => (t.threadId === threadId ? { ...t, unreadCountForCoach: 0 } : t))
        );
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to load messages.');
      } finally {
        if (!opts?.silent) setMessagesLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  const deleteSingleMessage = useCallback(
    async (messageId: string) => {
      if (!messageId) return;
      setMessageDeleteLoading(true);
      setMessageError('');

      try {
        await request(`/api/messages/${messageId}`, { method: 'DELETE' });
        setThreadMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedMessageIds((prev) => {
          if (!prev.has(messageId)) return prev;
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });

        // Refresh thread previews/unread counts without disrupting the open thread.
        void loadMessageThreads(true, { silent: true });
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to delete message.');
      } finally {
        setMessageDeleteLoading(false);
      }
    },
    [loadMessageThreads, request]
  );

  const deleteSelectedMessages = useCallback(
    async (messageIds: string[]) => {
      if (messageIds.length === 0) return;
      setMessageDeleteLoading(true);
      setMessageError('');

      try {
        await request<{ deleted: number }>('/api/messages/bulk-delete', {
          method: 'POST',
          data: { messageIds },
        });

        const toDelete = new Set(messageIds);
        setThreadMessages((prev) => prev.filter((m) => !toDelete.has(m.id)));
        setSelectedMessageIds(new Set());
        void loadMessageThreads(true, { silent: true });
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to delete messages.');
      } finally {
        setMessageDeleteLoading(false);
      }
    },
    [loadMessageThreads, request]
  );

  const clearAllMessagesInThread = useCallback(
    async (threadId: string) => {
      if (!threadId) return;
      setMessageDeleteLoading(true);
      setMessageError('');

      try {
        await request<{ deleted: number }>(`/api/messages/thread/${threadId}`, { method: 'DELETE' });
        setThreadMessages([]);
        setSelectedMessageIds(new Set());
        void loadMessageThreads(true, { silent: true });
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to delete thread messages.');
      } finally {
        setMessageDeleteLoading(false);
      }
    },
    [loadMessageThreads, request]
  );

  useEffect(() => {
    if (user?.role === 'COACH') {
      void loadMessageThreads();
    }
  }, [loadMessageThreads, user?.role]);

  // Background refresh every 30s (avoid UI flicker by loading silently).
  useEffect(() => {
    if (user?.role !== 'COACH') return;

    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (messagePollInFlightRef.current) return;

      messagePollInFlightRef.current = true;
      (async () => {
        try {
          await loadMessageThreads(true, { silent: true });
          if (selectedThreadId) {
            await loadThreadMessages(selectedThreadId, true, { silent: true });
          }
        } finally {
          messagePollInFlightRef.current = false;
        }
      })();
    }, 30_000);

    return () => window.clearInterval(id);
  }, [loadMessageThreads, loadThreadMessages, selectedThreadId, user?.role]);

  useEffect(() => {
    if (user?.role !== 'COACH') return;
    if (messageAthleteId) return;
    if (sortedMessageThreads.length === 0) return;
    // Default selection: newest unread thread, else newest thread.
    setMessageAthleteId(sortedMessageThreads[0].athlete.id);
  }, [messageAthleteId, sortedMessageThreads, user?.role]);

  useEffect(() => {
    if (!messageAthleteId) {
      setSelectedThreadId(null);
      setThreadMessages([]);
      return;
    }

    const tid = threadIdByAthleteId.get(messageAthleteId) ?? null;
    // Only reload when the selected thread actually changes.
    if (tid !== selectedThreadId) {
      setSelectedThreadId(tid);
      if (tid) {
        void loadThreadMessages(tid);
      } else {
        setThreadMessages([]);
      }
    }
  }, [loadThreadMessages, messageAthleteId, selectedThreadId, threadIdByAthleteId]);

  // Reset selection + dialogs when switching threads.
  useEffect(() => {
    setSelectedMessageIds(new Set());
    setDeleteMessageId(null);
    setBulkDeleteConfirmOpen(false);
    setClearAllConfirmOpen(false);
  }, [selectedThreadId]);

  const sendMessageToSelectedAthlete = useCallback(async () => {
    if (!messageAthleteId) {
      setMessageError('Select an athlete first.');
      return;
    }

    const body = messageDraft.trim();
    if (!body) return;

    setMessageSending(true);
    setMessageError('');
    setMessageStatus('');

    try {
      const resp = await request<{ sent: number; threadIds: string[] }>('/api/messages/send', {
        method: 'POST',
        data: { body, recipients: { athleteIds: [messageAthleteId] } },
      });

      setMessageDraft('');
      setMessageStatus(`Sent to ${resp.sent} athlete${resp.sent === 1 ? '' : 's'}`);
      void loadMessageThreads(true);

      const tid = resp.threadIds[0] ?? null;
      if (tid) {
        setSelectedThreadId(tid);
        void loadThreadMessages(tid, true);
      }
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setMessageSending(false);
    }
  }, [loadMessageThreads, loadThreadMessages, messageAthleteId, messageDraft, request]);

  // Keep the three top cards the same height at desktop (xl), using the Needs card as the baseline.
  // Note: this must initialize after the coach UI renders; during the loading gate the ref is null.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (userLoading) return;
    if (!user || user.role !== 'COACH') return;

    const mql = window.matchMedia('(min-width: 1280px)');
    const compute = () => {
      if (!mql.matches) {
        setXlTopCardHeightPx(null);
        return;
      }
      const h = needsCardRef.current?.getBoundingClientRect().height;
      if (!h || !Number.isFinite(h) || h <= 0) return;
      setXlTopCardHeightPx(Math.round(h));
    };

    compute();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => compute()) : null;
    if (ro && needsCardRef.current) ro.observe(needsCardRef.current);
    const onChange = () => compute();
    mql.addEventListener('change', onChange);
    window.addEventListener('resize', onChange);

    return () => {
      ro?.disconnect();
      mql.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [user, userLoading]);

  // If the global filters change, clear any inbox shortcut filter.
  useEffect(() => {
    setInboxPreset('ALL');
  }, [dateRange.from, dateRange.to, athleteId, discipline]);

  const disciplineOptions = useMemo(() => {
    const set = new Set<string>();
    (data?.athletes ?? []).forEach((a) => (a.disciplines ?? []).forEach((d) => set.add((d || '').toUpperCase())));
    ['BIKE', 'RUN', 'SWIM', 'OTHER'].forEach((d) => set.add(d));
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [data?.athletes]);

  const inboxItems = useMemo(() => {
    const items = data?.reviewInbox ?? [];
    if (inboxPreset === 'ALL' || inboxPreset === 'AWAITING_REVIEW') return items;
    if (inboxPreset === 'PAIN') return items.filter((i) => i.latestCompletedActivity?.painFlag);
    if (inboxPreset === 'COMMENTS') return items.filter((i) => i.hasAthleteComment);
    if (inboxPreset === 'SKIPPED') return items.filter((i) => i.status === 'SKIPPED');
    return items;
  }, [data?.reviewInbox, inboxPreset]);

  // Keep bulk selection aligned to the currently visible inbox dataset.
  useEffect(() => {
    const allowedIds = new Set(inboxItems.map((item) => item.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (allowedIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [inboxItems]);

  const selectedCount = selectedIds.size;

  const handleToggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkMarkReviewed = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    setBulkLoading(true);
    setError('');
    try {
      await request('/api/coach/review-inbox/bulk-review', {
        method: 'POST',
        data: { ids },
      });

      setData((prev) => {
        if (!prev) return prev;
        const nextInbox = prev.reviewInbox.filter((item) => !selectedIds.has(item.id));
        return {
          ...prev,
          attention: {
            ...prev.attention,
            awaitingCoachReview: Math.max(0, prev.attention.awaitingCoachReview - selectedIds.size),
          },
          reviewInbox: nextInbox,
        };
      });

      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk mark reviewed.');
    } finally {
      setBulkLoading(false);
    }
  }, [clearSelection, request, selectedIds]);

  const markReviewed = useCallback(
    async (id: string) => {
      await request(`/api/coach/calendar-items/${id}/review`, { method: 'POST' });
      await reload(true);
    },
    [reload, request]
  );

  const jumpToInbox = useCallback(() => {
    reviewInboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const toggleInboxPreset = useCallback(
    (next: InboxPreset) => {
      setInboxPreset((prev) => (prev === next ? 'ALL' : next));
      jumpToInbox();
    },
    [jumpToInbox]
  );

  if (userLoading) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== 'COACH') {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Coach access required.</p>
      </div>
    );
  }

  return (
    <>
      <section className="px-4 pb-10 md:px-6">
        <div className="pt-3 md:pt-6">
          <h1 className={cn(uiH1, 'font-semibold')}>Coach Console</h1>
        </div>

        {/* Top grid shell: mobile 1 col (Filters → Needs → At a glance), tablet 2 cols (Needs + Filters, then At a glance), desktop 3 cols */}
        <div className="mt-3 grid grid-cols-1 gap-4 min-w-0 items-start md:mt-4 md:gap-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Column 1: Needs your attention */}
          <div className="min-w-0 order-2 md:order-2">
            <div ref={needsCardRef} className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
              <div className="flex items-end justify-between gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--text)]">Needs your attention</h2>
                <div className="text-xs text-[var(--muted)]">Tap to focus inbox</div>
              </div>

              <div className="grid gap-2">
                <AttentionItem
                  label="Workouts with pain flags"
                  count={data?.attention.painFlagWorkouts ?? 0}
                  tone="danger"
                  active={inboxPreset === 'PAIN'}
                  onClick={() => toggleInboxPreset('PAIN')}
                />
                <AttentionItem
                  label="Workouts with athlete comments"
                  count={data?.attention.athleteCommentWorkouts ?? 0}
                  tone="primary"
                  active={inboxPreset === 'COMMENTS'}
                  onClick={() => toggleInboxPreset('COMMENTS')}
                />
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <AlertStripItem
                  label="Skipped workouts"
                  count={data?.attention.skippedWorkouts ?? 0}
                  active={inboxPreset === 'SKIPPED'}
                  onClick={() => toggleInboxPreset('SKIPPED')}
                />
                <AlertStripItem
                  label="Awaiting coach review"
                  count={data?.attention.awaitingCoachReview ?? 0}
                  active={inboxPreset === 'AWAITING_REVIEW'}
                  onClick={() => toggleInboxPreset('AWAITING_REVIEW')}
                />
              </div>
            </div>
          </div>

          {/* Column 2: Filters/selectors */}
          <div className="min-w-0 order-1 md:order-1">
            <div
              className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4"
              style={xlTopCardHeightPx ? { height: `${xlTopCardHeightPx}px` } : undefined}
            >
              <div className="flex items-end justify-between gap-3 mb-4">
                <h2 className="text-sm font-semibold text-[var(--text)]">Make your selection</h2>
                <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-x-4 md:gap-y-2">
                {/* Row 1 */}
                <div className="md:col-start-1 md:row-start-1">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Athlete</div>
                  <Select className="min-h-[44px]" value={athleteId ?? ''} onChange={(e) => setAthleteId(e.target.value ? e.target.value : null)}>
                    <option value="">All athletes</option>
                    {(data?.athletes ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name ?? 'Unnamed athlete'}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="md:col-start-2 md:row-start-1">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Discipline (optional)</div>
                  <Select className="min-h-[44px]" value={discipline ?? ''} onChange={(e) => setDiscipline(e.target.value ? e.target.value : null)}>
                    <option value="">All disciplines</option>
                    {disciplineOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Row 2 */}
                <div className="md:col-start-1 md:row-start-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Time range</div>
                  <Select className="min-h-[44px]" value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRangePreset)}>
                    <option value="LAST_7">Last 7 days</option>
                    <option value="LAST_14">Last 14 days</option>
                    <option value="LAST_30">Last 30 days</option>
                    <option value="CUSTOM">Custom</option>
                  </Select>

                  {timeRange === 'CUSTOM' ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">From</div>
                        <input
                          type="date"
                          className="w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--text)]"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                        />
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">To</div>
                        <input
                          type="date"
                          className="w-full min-h-[44px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--text)]"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="md:col-start-2 md:row-start-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">&nbsp;</div>
                  <div className="min-h-[44px] flex items-center">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      {formatCalendarDayLabel(dateRange.from, coachTimeZone)} → {formatCalendarDayLabel(dateRange.to, coachTimeZone)}
                    </div>
                  </div>
                </div>

                {/* Row 3 gap */}
                <div className="col-span-1 md:col-span-2 h-1 md:h-2" aria-hidden="true" />

                {/* Row 4 */}
                <div className="md:col-span-2 flex items-center justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={() => reload(true)} className="min-h-[44px]">
                    <Icon name="refresh" size="sm" className="mr-1" aria-hidden />
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Column 3: At a glance (stacks vertically); on tablet sits below and spans full width */}
          <div className="min-w-0 md:order-3 md:col-span-2 xl:col-span-1">
            <div
              className="rounded-2xl bg-[var(--bg-card)] p-3 min-h-0 flex flex-col"
              data-testid="coach-dashboard-at-a-glance"
              style={xlTopCardHeightPx ? { minHeight: `${xlTopCardHeightPx}px` } : undefined}
            >
              <div className="flex items-end justify-between gap-3 mb-2">
                <h2 className="text-sm font-semibold text-[var(--text)]">At a glance</h2>
                <div className="text-xs text-[var(--muted)]" aria-hidden="true" />
              </div>

              <div
                className="grid grid-cols-1 items-start min-[520px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[520px]:items-center gap-3 min-w-0"
                data-testid="coach-dashboard-at-a-glance-grid"
              >
                {/* Left: stats */}
                <div className="min-w-0 rounded-2xl bg-[var(--bg-structure)]/40 px-3 py-2" data-testid="coach-dashboard-at-a-glance-stats">
                  <div className="grid gap-1">
                    {[
                      { label: 'WORKOUTS COMPLETED', value: String(data?.kpis.workoutsCompleted ?? 0) },
                      { label: 'WORKOUTS MISSED', value: String(data?.kpis.workoutsSkipped ?? 0) },
                      { label: 'TOTAL TRAINING TIME', value: formatMinutes(data?.kpis.totalTrainingMinutes ?? 0) },
                      { label: 'TOTAL DISTANCE', value: formatDistanceKm(data?.kpis.totalDistanceKm ?? 0) },
                    ].map((row, idx) => (
                      <div
                        key={row.label}
                        className={cn(
                          'min-w-0 flex items-baseline justify-between gap-3 py-[7px]',
                          idx < 3 ? 'border-b border-black/5' : ''
                        )}
                        data-testid="coach-dashboard-at-a-glance-stat-row"
                      >
                        <div className="min-w-0 text-[10px] uppercase tracking-wide text-[var(--muted)]/90 truncate" title={row.label}>
                          {row.label}
                        </div>
                        <div className="flex-shrink-0 text-[14px] sm:text-[16px] leading-[1.05] font-semibold tabular-nums text-[var(--text)]">
                          {row.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: discipline load */}
                <div className="min-w-0 rounded-2xl bg-[var(--bg-structure)]/40 px-3 py-2" data-testid="coach-dashboard-discipline-load">
                  <div className="flex flex-col gap-2">
                    {(() => {
                      const rows = data?.disciplineLoad ?? [];
                      const maxMinutes = Math.max(1, ...rows.map((r) => r.totalMinutes));
                      return (
                        <>
                          {rows.map((r) => {
                            const theme = getDisciplineTheme(r.discipline);
                            const pct = Math.max(0, Math.min(1, r.totalMinutes / maxMinutes));
                            const rightValue = `${formatMinutes(r.totalMinutes)} · ${formatDistanceKm(r.totalDistanceKm)}`;
                            return (
                              <div key={r.discipline} className="grid grid-cols-[auto,1fr,auto] items-center gap-2 min-w-0">
                                <div className="flex items-center gap-2 min-w-[64px]">
                                  <Icon name={theme.iconName} size="sm" className={theme.textClass} aria-hidden />
                                  <span className="text-[11px] font-medium text-[var(--text)]">{(r.discipline || 'OTHER').toUpperCase()}</span>
                                </div>

                                <div className="h-2 rounded-full bg-black/10 overflow-hidden">
                                  <div className="h-full rounded-full bg-black/25" style={{ width: `${Math.round(pct * 100)}%` }} />
                                </div>

                                <div
                                  className="text-[11px] text-[var(--muted)] tabular-nums text-right whitespace-nowrap truncate max-w-[120px]"
                                  title={rightValue}
                                >
                                  {rightValue}
                                </div>
                              </div>
                            );
                          })}
                          {rows.length === 0 ? <div className="text-sm text-[var(--muted)] px-1 py-2">No data for this range.</div> : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-2xl bg-rose-500/10 text-rose-700 p-4 text-sm">{error}</div> : null}

        {/* Review Inbox + Messages split (desktop/tablet); stacked on mobile */}
        <div className="mt-10 grid grid-cols-1 gap-6 items-start md:grid-cols-2">
          {/* LEFT: Review inbox */}
          <div className="min-w-0" ref={reviewInboxRef} id="review-inbox" data-testid="coach-dashboard-review-inbox">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2 pl-3 md:pl-4">
              <h2 className="text-sm font-semibold text-[var(--text)]">Review inbox</h2>
            </div>

            <div className="rounded-2xl bg-[var(--bg-card)] overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between gap-3 border-b border-black/5">
                <div className="text-xs text-[var(--muted)]">
                  Showing <span className="font-medium text-[var(--text)] tabular-nums">{inboxItems.length}</span>
                  {inboxPreset !== 'ALL' && inboxPreset !== 'AWAITING_REVIEW' ? <span className="ml-2">(focused)</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" onClick={handleBulkMarkReviewed} disabled={bulkLoading || selectedCount === 0} className="min-h-[44px]">
                    {bulkLoading ? 'Marking…' : `Mark Reviewed${selectedCount ? ` (${selectedCount})` : ''}`}
                  </Button>
                  <Button type="button" variant="ghost" onClick={clearSelection} disabled={selectedCount === 0} className="min-h-[44px]">
                    Clear
                  </Button>
                </div>
              </div>

              {loading ? <div className="px-4 py-6 text-sm text-[var(--muted)]">Loading…</div> : null}
              {!loading && inboxItems.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">Nothing to review for this range.</div> : null}

              <div className="divide-y divide-black/5">
                {inboxItems.map((item) => (
                  <ReviewInboxRow
                    key={item.id}
                    item={item}
                    isChecked={selectedIds.has(item.id)}
                    onToggleSelected={handleToggleSelected}
                    onOpen={(it) => setSelectedItem(it)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: Messages */}
          <div className="min-w-0" data-testid="coach-dashboard-messages">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2 pl-3 md:pl-4">
              <h2 className="text-sm font-semibold text-[var(--text)]">Messages</h2>
            </div>

            <div className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Athlete</div>
                    <Select
                      className="min-h-[44px]"
                      value={messageAthleteId}
                      onChange={(e) => setMessageAthleteId(e.target.value)}
                      aria-label="Select athlete thread"
                    >
                      <option value="">Select an athlete</option>
                      {(data?.athletes ?? []).map((a) => {
                        const thread = messageThreads.find((mt) => mt.athlete.id === a.id);
                        const unread = thread?.unreadCountForCoach ?? 0;
                        const suffix = unread > 0 ? ` (${unread} new)` : '';
                        return (
                          <option key={a.id} value={a.id}>
                            {(a.name ?? 'Unnamed athlete') + suffix}
                          </option>
                        );
                      })}
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={cn(
                      'min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors',
                      'border border-[var(--border-subtle)]',
                      selectedThreadId && threadMessages.length > 0 && !messageDeleteLoading
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'bg-[var(--bg-surface)] text-[var(--muted)]'
                    )}
                    onClick={() => setClearAllConfirmOpen(true)}
                    disabled={!selectedThreadId || threadMessages.length === 0 || messageDeleteLoading}
                    aria-label="Clear all messages in this conversation"
                  >
                    Clear all
                  </button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-[44px] px-3"
                    onClick={() => loadMessageThreads(true)}
                    aria-label="Refresh inbox"
                  >
                    <Icon name="refresh" size="sm" aria-hidden />
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[44px]"
                    onClick={openBroadcast}
                    data-testid="coach-dashboard-messages-broadcast"
                  >
                    Broadcast
                  </Button>
                </div>
              </div>

              {messageStatus ? <div className="mt-3 text-sm text-emerald-700">{messageStatus}</div> : null}
              {messageError ? <div className="mt-3 text-sm text-rose-700">{messageError}</div> : null}

              {/* Compose + thread */}
              <div className="min-w-0">
                <div className="grid gap-2" data-testid="coach-dashboard-messages-compose">
                  <Textarea
                    rows={3}
                    placeholder={messageAthleteId ? 'Write a message…' : 'Select an athlete to reply…'}
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    className="text-sm"
                    disabled={!messageAthleteId || messageSending}
                  />

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      className="min-h-[44px]"
                      onClick={sendMessageToSelectedAthlete}
                      disabled={!messageAthleteId || messageSending || messageDraft.trim().length === 0}
                    >
                      {messageSending ? 'Sending…' : 'Send'}
                    </Button>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-[var(--bg-surface)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-[var(--muted)]">
                      {messagesLoading ? 'Loading messages…' : selectedThreadId ? 'Thread' : 'Select an athlete above'}
                    </div>
                    {selectedThreadId ? (
                      <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => loadThreadMessages(selectedThreadId, true)}>
                        <Icon name="refresh" size="sm" className="mr-1" aria-hidden />
                        Refresh
                      </Button>
                    ) : null}
                  </div>

                  {selectedThreadId && threadMessages.length > 0 ? (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-rose-600"
                          checked={allVisibleMessagesSelected}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelectedMessageIds(() => (checked ? new Set(visibleThreadMessageIds) : new Set()));
                          }}
                          aria-label="Select all messages"
                        />
                        <span>Select all</span>
                      </label>
                      <div className="text-xs text-[var(--muted)] tabular-nums">{threadMessages.length} messages</div>
                    </div>
                  ) : null}

                  {!messagesLoading && selectedThreadId && threadMessages.length === 0 ? (
                    <div className="mt-3 text-sm text-[var(--muted)]">No messages yet.</div>
                  ) : null}

                  <div className="mt-3 flex flex-col gap-2">
                    {threadMessages.map((m) => {
                      const mine = m.senderRole === 'COACH';
                      const senderLabel = mine ? 'COACH' : selectedAthleteNameForThread;
                      const checked = selectedMessageIds.has(m.id);
                      return (
                        <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                          <div className="flex items-start gap-2 max-w-[min(560px,92%)]">
                            <label className="h-9 w-9 flex items-center justify-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-rose-600"
                                checked={checked}
                                onChange={(e) => {
                                  const nextChecked = e.target.checked;
                                  setSelectedMessageIds((prev) => {
                                    const next = new Set(prev);
                                    if (nextChecked) next.add(m.id);
                                    else next.delete(m.id);
                                    return next;
                                  });
                                }}
                                aria-label="Select message"
                              />
                            </label>

                            <div
                              className={cn(
                                'min-w-0 flex-1 rounded-2xl px-3 py-2 border',
                                mine
                                  ? 'bg-[var(--bg-card)] border-[var(--border-subtle)]'
                                  : 'bg-[var(--bg-structure)] border-black/10'
                              )}
                            >
                              <div className="text-sm whitespace-pre-wrap text-[var(--text)]">{m.body}</div>
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                                  {senderLabel} · {new Date(m.createdAt).toLocaleString()}
                                </div>
                                <button
                                  type="button"
                                  className={cn(
                                    'h-8 w-8 inline-flex items-center justify-center rounded-full transition-colors',
                                    'border border-black/10 bg-white/40 text-rose-700 hover:bg-white/60',
                                    messageDeleteLoading ? 'opacity-60 cursor-not-allowed' : ''
                                  )}
                                  onClick={() => setDeleteMessageId(m.id)}
                                  disabled={messageDeleteLoading}
                                  aria-label="Delete message"
                                >
                                  <Icon name="delete" size="sm" aria-hidden />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {selectedVisibleMessageCount > 0 ? (
                    <div className="sticky bottom-0 mt-3 rounded-2xl border border-black/10 bg-[var(--bg-card)] p-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-[var(--muted)] tabular-nums">{selectedVisibleMessageCount} selected</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={cn(
                              'min-h-[36px] rounded-full px-3 py-1.5 text-sm font-medium',
                              'bg-rose-600 text-white hover:bg-rose-700',
                              messageDeleteLoading ? 'opacity-60 cursor-not-allowed' : ''
                            )}
                            onClick={() => setBulkDeleteConfirmOpen(true)}
                            disabled={messageDeleteLoading}
                          >
                            Delete selected
                          </button>
                          <button
                            type="button"
                            className="min-h-[36px] rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)]"
                            onClick={() => setSelectedMessageIds(new Set())}
                            disabled={messageDeleteLoading}
                          >
                            Clear selection
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ConfirmModal
        isOpen={deleteMessageId !== null}
        title="Delete message?"
        message="This will remove the message from this conversation."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={async () => {
          const id = deleteMessageId;
          setDeleteMessageId(null);
          if (id) await deleteSingleMessage(id);
        }}
        onCancel={() => setDeleteMessageId(null)}
      />

      <ConfirmModal
        isOpen={bulkDeleteConfirmOpen}
        title={`Delete ${selectedVisibleMessageCount} messages?`}
        message="This will remove the message from this conversation."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={async () => {
          setBulkDeleteConfirmOpen(false);
          const ids = visibleThreadMessageIds.filter((id) => selectedMessageIds.has(id));
          await deleteSelectedMessages(ids);
        }}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={clearAllConfirmOpen}
        title="Delete all messages in this conversation?"
        message="This cannot be undone."
        confirmLabel="Delete all"
        cancelLabel="Cancel"
        onConfirm={async () => {
          setClearAllConfirmOpen(false);
          if (selectedThreadId) await clearAllMessagesInThread(selectedThreadId);
        }}
        onCancel={() => setClearAllConfirmOpen(false)}
      />

      {broadcastOpen ? (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={closeBroadcast} />

          <div
            className="fixed left-1/2 top-1/2 z-[60] w-[min(720px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 md:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Broadcast message"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-[var(--text)]">Broadcast message</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">Send one message to multiple athletes.</p>
              </div>
              <Button type="button" variant="ghost" className="min-h-[44px]" onClick={closeBroadcast} aria-label="Close broadcast modal">
                <Icon name="close" size="sm" aria-hidden />
              </Button>
            </div>

            {broadcastError ? <div className="mt-3 text-sm text-rose-700">{broadcastError}</div> : null}

            <div className="mt-4 grid gap-3">
              <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={broadcastAllAthletes}
                  onChange={(e) => setBroadcastAllAthletes(e.target.checked)}
                />
                <span>All athletes ({(data?.athletes ?? []).length})</span>
              </label>

              {!broadcastAllAthletes ? (
                <>
                  <div className="grid gap-1">
                    <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Select athletes</div>
                    <Input
                      value={broadcastFilter}
                      onChange={(e) => setBroadcastFilter(e.target.value)}
                      placeholder="Filter by name…"
                      aria-label="Filter athletes"
                    />
                  </div>

                  <div className="max-h-[260px] overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
                    {(data?.athletes ?? [])
                      .filter((a) => {
                        const name = (a.name ?? 'Unnamed athlete').toLowerCase();
                        return name.includes(broadcastFilter.trim().toLowerCase());
                      })
                      .map((a) => {
                        const checked = broadcastSelectedAthleteIds.has(a.id);
                        return (
                          <label key={a.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-black/5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setBroadcastSelectedAthleteIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(a.id);
                                  else next.delete(a.id);
                                  return next;
                                });
                              }}
                            />
                            <span className="text-sm text-[var(--text)]">{a.name ?? 'Unnamed athlete'}</span>
                          </label>
                        );
                      })}

                    {(data?.athletes ?? []).length > 0 &&
                    (data?.athletes ?? []).filter((a) => (a.name ?? 'Unnamed athlete').toLowerCase().includes(broadcastFilter.trim().toLowerCase()))
                      .length === 0 ? (
                      <div className="px-2 py-3 text-sm text-[var(--muted)]">No matches.</div>
                    ) : null}
                  </div>

                  <div className="text-xs text-[var(--muted)]">
                    Selected: {broadcastSelectedAthleteIds.size}
                  </div>
                </>
              ) : null}

              <div className="grid gap-2">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Message</div>
                <Textarea
                  rows={5}
                  value={broadcastDraft}
                  onChange={(e) => setBroadcastDraft(e.target.value)}
                  placeholder="Write your broadcast message…"
                  disabled={broadcastSending}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" className="min-h-[44px]" onClick={closeBroadcast} disabled={broadcastSending}>
                Cancel
              </Button>
              <Button
                type="button"
                className="min-h-[44px]"
                onClick={sendBroadcast}
                disabled={
                  broadcastSending ||
                  broadcastDraft.trim().length === 0 ||
                  (!broadcastAllAthletes && broadcastSelectedAthleteIds.size === 0)
                }
              >
                {broadcastSending ? 'Sending…' : 'Send broadcast'}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <ReviewDrawer item={selectedItem} onClose={() => setSelectedItem(null)} onMarkReviewed={markReviewed} showSessionTimes={false} />
    </>
  );
}
