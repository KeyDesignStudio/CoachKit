'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Icon } from '@/components/ui/Icon';
import { Textarea } from '@/components/ui/Textarea';
import { uiH1 } from '@/components/ui/typography';
import { cn } from '@/lib/cn';

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

export default function AthleteNotificationsConsolePage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const athleteDisplayName = user?.name ?? 'You';

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessagesResponse['messages']>([]);
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

  const messagePollInFlightRef = useRef(false);

  const displayMessages = useMemo(() => {
    const rows = [...messages];
    rows.sort((a, b) => {
      const aAt = +new Date(a.createdAt);
      const bAt = +new Date(b.createdAt);
      if (aAt !== bAt) return bAt - aAt;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }, [messages]);

  const visibleThreadMessageIds = useMemo(() => displayMessages.map((m) => m.id), [displayMessages]);

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

  const deleteSingleMessage = useCallback(
    async (messageId: string) => {
      if (!messageId) return;
      setMessageDeleteLoading(true);
      setMessageError('');

      try {
        await request(`/api/messages/${messageId}`, { method: 'DELETE' });
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
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
        setMessages((prev) => prev.filter((m) => !toDelete.has(m.id)));
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
        setMessages([]);
        setSelectedMessageIds(new Set());
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to delete thread messages.');
      } finally {
        setMessageDeleteLoading(false);
      }
    },
    [request]
  );

  const loadThread = useCallback(
    async (bypassCache = false, opts?: { silent?: boolean }) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      if (!opts?.silent) setThreadsLoading(true);
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
        if (!opts?.silent) setThreadsLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  const loadMessages = useCallback(
    async (tid: string, bypassCache = false, opts?: { silent?: boolean; skipThreadReload?: boolean }) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      if (!opts?.silent) setMessagesLoading(true);
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
        if (!opts?.skipThreadReload) void loadThread();
      } catch (err) {
        setMessageError(err instanceof Error ? err.message : 'Failed to load messages.');
      } finally {
        if (!opts?.silent) setMessagesLoading(false);
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
      void loadThread();
    }
  }, [loadThread, user?.role]);

  // Background refresh every 30s (avoid UI flicker by loading silently).
  useEffect(() => {
    if (user?.role !== 'ATHLETE') return;

    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (messagePollInFlightRef.current) return;

      messagePollInFlightRef.current = true;
      (async () => {
        try {
          await loadThread(true, { silent: true });
          if (threadId) {
            await loadMessages(threadId, true, { silent: true, skipThreadReload: true });
          }
        } finally {
          messagePollInFlightRef.current = false;
        }
      })();
    }, 30_000);

    return () => window.clearInterval(id);
  }, [loadMessages, loadThread, threadId, user?.role]);

  useEffect(() => {
    if (threadId) {
      void loadMessages(threadId);
    } else {
      setMessages([]);
    }
  }, [loadMessages, threadId]);

  // Reset selection + dialogs when the thread changes.
  useEffect(() => {
    setSelectedMessageIds(new Set());
    setDeleteMessageId(null);
    setBulkDeleteConfirmOpen(false);
    setClearAllConfirmOpen(false);
  }, [threadId]);

  if (userLoading) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== 'ATHLETE') {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Athlete access required.</p>
      </div>
    );
  }

  return (
    <>
      <section className="px-4 pb-10 md:px-6">
        <div className="pt-3 md:pt-6">
          <h1 className={cn(uiH1, 'font-semibold')}>Notifications</h1>
        </div>

        <div className="mt-6" data-testid="athlete-notifications-messages">
          <div className="rounded-2xl bg-[var(--bg-card)] p-3 md:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--text)]">Messages</h2>
                <div className="text-xs font-medium text-[var(--muted)] mt-0.5">Message your coach</div>
              </div>

              <button
                type="button"
                className={cn(
                  'min-h-[44px] rounded-full px-3 py-2 text-xs font-medium transition-colors md:px-4 md:text-sm',
                  'border border-[var(--border-subtle)]',
                  threadId && messages.length > 0 && !messageDeleteLoading
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-[var(--bg-surface)] text-[var(--muted)]'
                )}
                onClick={() => setClearAllConfirmOpen(true)}
                disabled={!threadId || messages.length === 0 || messageDeleteLoading}
                aria-label="Clear all messages in this conversation"
              >
                Clear all
              </button>
            </div>

            <div className="mt-2 grid gap-2" data-testid="athlete-notifications-messages-compose">
              <Textarea
                rows={3}
                placeholder="Write a message…"
                className="text-sm"
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                disabled={messageSending}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  className="min-h-[44px] text-xs px-4 py-1.5 md:text-sm md:px-5 md:py-2"
                  onClick={sendMessage}
                  disabled={messageSending || messageDraft.trim().length === 0}
                >
                  {messageSending ? 'Sending…' : 'Send'}
                </Button>
              </div>
              {messageStatus ? <div className="text-xs text-emerald-700">{messageStatus}</div> : null}
              {messageError ? <div className="text-xs text-rose-700">{messageError}</div> : null}
            </div>

            <div className="mt-4 rounded-2xl bg-[var(--bg-surface)] p-3">
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

              {threadId && messages.length > 0 ? (
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
                  <div className="text-xs text-[var(--muted)] tabular-nums">{messages.length} messages</div>
                </div>
              ) : null}

              {messagesLoading ? <div className="mt-3 text-sm text-[var(--muted)]">Loading messages…</div> : null}
              {!messagesLoading && threadId && messages.length === 0 ? (
                <div className="mt-3 text-sm text-[var(--muted)]">No messages yet.</div>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {displayMessages.map((m) => {
                  const mine = m.senderRole === 'ATHLETE';
                  const senderLabel = mine ? athleteDisplayName : 'COACH';
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
                            mine ? 'bg-[var(--bg-card)] border-[var(--border-subtle)]' : 'bg-[var(--bg-structure)] border-black/10'
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
                              <Icon name="delete" size="sm" className="text-[13px] md:text-base" aria-hidden />
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
      </section>

      <ConfirmModal
        isOpen={Boolean(deleteMessageId)}
        title="Delete message?"
        message="This will remove the message from this conversation."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onCancel={() => setDeleteMessageId(null)}
        onConfirm={async () => {
          if (messageDeleteLoading) return;
          if (!deleteMessageId) return;
          const id = deleteMessageId;
          setDeleteMessageId(null);
          await deleteSingleMessage(id);
        }}
      />

      <ConfirmModal
        isOpen={bulkDeleteConfirmOpen}
        title={`Delete ${selectedVisibleMessageCount} messages?`}
        message="This will remove the message from this conversation."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onCancel={() => setBulkDeleteConfirmOpen(false)}
        onConfirm={async () => {
          if (messageDeleteLoading) return;
          const ids = visibleThreadMessageIds.filter((id) => selectedMessageIds.has(id));
          setBulkDeleteConfirmOpen(false);
          await deleteSelectedMessages(ids);
        }}
      />

      <ConfirmModal
        isOpen={clearAllConfirmOpen}
        title="Delete all messages in this conversation?"
        message="This cannot be undone."
        confirmLabel="Delete all"
        cancelLabel="Cancel"
        onCancel={() => setClearAllConfirmOpen(false)}
        onConfirm={async () => {
          if (messageDeleteLoading) return;
          if (!threadId) return;
          const tid = threadId;
          setClearAllConfirmOpen(false);
          await clearAllMessagesInThread(tid);
        }}
      />
    </>
  );
}
