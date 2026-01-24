'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { uiH1 } from '@/components/ui/typography';
import { cn } from '@/lib/cn';

type DashboardAthlete = {
  id: string;
  name: string | null;
  disciplines: string[];
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

export default function CoachNotificationsConsolePage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const [athletes, setAthletes] = useState<DashboardAthlete[]>([]);

  const [messageThreads, setMessageThreads] = useState<MessageThreadSummary[]>([]);
  const [messageAthleteId, setMessageAthleteId] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessagesResponse['messages']>([]);

  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [messageStatus, setMessageStatus] = useState('');
  const [messageError, setMessageError] = useState('');

  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [messageDeleteLoading, setMessageDeleteLoading] = useState(false);

  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastDraft, setBroadcastDraft] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastError, setBroadcastError] = useState('');
  const [broadcastAllAthletes, setBroadcastAllAthletes] = useState(true);
  const [broadcastFilter, setBroadcastFilter] = useState('');
  const [broadcastSelectedAthleteIds, setBroadcastSelectedAthleteIds] = useState<Set<string>>(() => new Set());

  const loadAthletes = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'COACH') return;

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      const url = qs.toString() ? `/api/coach/dashboard/console?${qs.toString()}` : '/api/coach/dashboard/console';

      const resp = await request<{ athletes: DashboardAthlete[] }>(url, bypassCache ? { cache: 'no-store' } : undefined);

      setAthletes(resp.athletes ?? []);
    },
    [request, user?.role, user?.userId]
  );

  const loadMessageThreads = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'COACH') return;

      if (!bypassCache) setThreadsLoading(true);
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
        if (!bypassCache) setThreadsLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  const threadIdByAthleteId = useMemo(() => {
    const map = new Map<string, string>();
    messageThreads.forEach((t) => map.set(t.athlete.id, t.threadId));
    return map;
  }, [messageThreads]);

  const sortedMessageThreads = useMemo(() => {
    const rows = [...messageThreads];
    rows.sort((a, b) => {
      const aUnread = a.unreadCountForCoach ?? 0;
      const bUnread = b.unreadCountForCoach ?? 0;
      if (aUnread !== bUnread) return bUnread - aUnread;

      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
    return rows;
  }, [messageThreads]);

  const selectedAthleteNameForThread = useMemo(() => {
    const tid = selectedThreadId;
    if (!tid) return 'ATHLETE';
    return messageThreads.find((t) => t.threadId === tid)?.athlete.name ?? 'ATHLETE';
  }, [messageThreads, selectedThreadId]);

  const displayThreadMessages = useMemo(() => {
    const rows = [...threadMessages];
    rows.sort((a, b) => {
      const aAt = +new Date(a.createdAt);
      const bAt = +new Date(b.createdAt);
      if (aAt !== bAt) return bAt - aAt;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }, [threadMessages]);

  const visibleThreadMessageIds = useMemo(() => displayThreadMessages.map((m) => m.id), [displayThreadMessages]);

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
        setMessageThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, unreadCountForCoach: 0 } : t)));
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to load messages.');
      } finally {
        if (!opts?.silent) setMessagesLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  const sendMessageToSelectedAthlete = useCallback(async () => {
    const body = messageDraft.trim();
    if (!body) return;
    if (!user?.userId || user.role !== 'COACH') return;

    setMessageSending(true);
    setMessageStatus('');
    setMessageError('');

    try {
      const resp = await request<{ sent: number; threadIds: string[] }>('/api/messages/send', {
        method: 'POST',
        data: { body, athleteUserId: messageAthleteId },
      });

      setMessageDraft('');
      setMessageStatus('Sent.');

      const tid = resp.threadIds[0] ?? selectedThreadId;
      if (tid) {
        setSelectedThreadId(tid);
        void loadThreadMessages(tid, true);
      } else {
        void loadMessageThreads(true);
      }
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setMessageSending(false);
    }
  }, [loadMessageThreads, loadThreadMessages, messageAthleteId, messageDraft, request, selectedThreadId, user?.role, user?.userId]);

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
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to delete message.');
      } finally {
        setMessageDeleteLoading(false);
      }
    },
    [request]
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
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to delete messages.');
      } finally {
        setMessageDeleteLoading(false);
      }
    },
    [request]
  );

  const clearAllMessagesInThread = useCallback(
    async (tid: string) => {
      if (!tid) return;
      setMessageDeleteLoading(true);
      setMessageError('');

      try {
        await request<{ deleted: number }>(`/api/messages/thread/${tid}`, { method: 'DELETE' });
        setThreadMessages([]);
        setSelectedMessageIds(new Set());
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to delete thread messages.');
      } finally {
        setMessageDeleteLoading(false);
      }
    },
    [request]
  );

  const openBroadcast = useCallback(() => {
    setBroadcastError('');
    setBroadcastDraft('');
    setBroadcastOpen(true);
  }, []);

  const closeBroadcast = useCallback(() => {
    if (broadcastSending) return;
    setBroadcastOpen(false);
  }, [broadcastSending]);

  const sendBroadcast = useCallback(async () => {
    const body = broadcastDraft.trim();
    if (!body) return;

    const ids = broadcastAllAthletes ? athletes.map((a) => a.id) : Array.from(broadcastSelectedAthleteIds);
    if (ids.length === 0) {
      setBroadcastError('Select at least one athlete.');
      return;
    }

    setBroadcastSending(true);
    setBroadcastError('');

    try {
      await request('/api/messages/broadcast', {
        method: 'POST',
        data: { body, athleteUserIds: ids },
      });

      setBroadcastOpen(false);
      await loadMessageThreads(true);
    } catch (err) {
      setBroadcastError(err instanceof Error ? err.message : 'Failed to send broadcast.');
    } finally {
      setBroadcastSending(false);
    }
  }, [athletes, broadcastAllAthletes, broadcastDraft, broadcastSelectedAthleteIds, loadMessageThreads, request]);

  useEffect(() => {
    if (user?.role === 'COACH') {
      void loadAthletes();
      void loadMessageThreads();
    }
  }, [loadAthletes, loadMessageThreads, user?.role]);

  useEffect(() => {
    const nextThreadId = messageAthleteId ? threadIdByAthleteId.get(messageAthleteId) ?? null : null;
    setSelectedThreadId(nextThreadId);
  }, [messageAthleteId, threadIdByAthleteId]);

  useEffect(() => {
    if (selectedThreadId) {
      void loadThreadMessages(selectedThreadId);
    } else {
      setThreadMessages([]);
    }
  }, [loadThreadMessages, selectedThreadId]);

  // Reset selection + dialogs when the thread changes.
  useEffect(() => {
    setSelectedMessageIds(new Set());
    setDeleteMessageId(null);
    setBulkDeleteConfirmOpen(false);
    setClearAllConfirmOpen(false);
  }, [selectedThreadId]);

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
          <h1 className={cn(uiH1, 'font-semibold')}>Messages</h1>
        </div>
        <div className="mt-6 min-w-0" data-testid="coach-notifications-messages">
          <div className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-[var(--text)]">Messages</h2>
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

                  <Button type="button" variant="secondary" className="min-h-[44px]" onClick={openBroadcast}>
                    Broadcast
                  </Button>
                </div>
              </div>

              <div className="mt-3 min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-0.5 leading-none">Athlete</div>
                <Select
                  className="min-h-[44px]"
                  value={messageAthleteId}
                  onChange={(e) => setMessageAthleteId(e.target.value)}
                  aria-label="Select athlete thread"
                >
                  <option value="">Select an athlete</option>
                  {athletes.map((a) => {
                    const thread = sortedMessageThreads.find((mt) => mt.athlete.id === a.id);
                    const unread = thread?.unreadCountForCoach ?? 0;
                    const suffix = unread > 0 ? ` (${unread} new)` : '';
                    return (
                      <option key={a.id} value={a.id}>
                        {(a.name ?? 'Unnamed athlete') + suffix}
                      </option>
                    );
                  })}
                </Select>
                {threadsLoading ? <div className="mt-2 text-xs text-[var(--muted)]">Loading threads…</div> : null}
              </div>

              {messageStatus ? <div className="mt-3 text-sm text-emerald-700">{messageStatus}</div> : null}
              {messageError ? <div className="mt-3 text-sm text-rose-700">{messageError}</div> : null}

              <div className="min-w-0">
                <div className="grid gap-2" data-testid="coach-notifications-messages-compose">
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
                    {displayThreadMessages.map((m) => {
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
                <input type="checkbox" checked={broadcastAllAthletes} onChange={(e) => setBroadcastAllAthletes(e.target.checked)} />
                <span>All athletes ({athletes.length})</span>
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
                    {athletes
                      .filter((a) => (a.name ?? 'Unnamed athlete').toLowerCase().includes(broadcastFilter.trim().toLowerCase()))
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

                    {athletes.length > 0 &&
                    athletes.filter((a) => (a.name ?? 'Unnamed athlete').toLowerCase().includes(broadcastFilter.trim().toLowerCase())).length === 0 ? (
                      <div className="px-2 py-3 text-sm text-[var(--muted)]">No matches.</div>
                    ) : null}
                  </div>

                  <div className="text-xs text-[var(--muted)]">Selected: {broadcastSelectedAthleteIds.size}</div>
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
                disabled={broadcastSending || broadcastDraft.trim().length === 0 || (!broadcastAllAthletes && broadcastSelectedAthleteIds.size === 0)}
              >
                {broadcastSending ? 'Sending…' : 'Send broadcast'}
              </Button>
            </div>
          </div>
        </>
      ) : null}

    </>
  );
}
