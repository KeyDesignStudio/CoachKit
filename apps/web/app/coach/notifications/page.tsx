'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';

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

function renderMessageBodyWithLinks(body: string, isCoach: boolean) {
  const parts = String(body ?? '').split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, idx) => {
        const isUrl = /^https?:\/\/[^\s]+$/.test(part);
        if (!isUrl) return <span key={`${idx}:${part}`}>{part}</span>;
        return (
          <a
            key={`${idx}:${part}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('underline underline-offset-2 break-all', isCoach ? 'text-white' : 'text-blue-700 dark:text-blue-300')}
          >
            {part}
          </a>
        );
      })}
    </>
  );
}

export default function CoachNotificationsPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const searchParams = useSearchParams();

  const [threads, setThreads] = useState<MessageThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState('');

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [messages, setMessages] = useState<ThreadMessagesResponse['messages']>([]);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedThreadRef = useRef<HTMLButtonElement | null>(null);

  // Deep-link handling: ?athleteId=...
  useEffect(() => {
    const athleteId = searchParams.get('athleteId');
    if (!athleteId || threadsLoading || !user || user.role !== 'COACH') return;

    // Check if we already have the thread
    const existing = threads.find((t) => t.athlete.id === athleteId);
    if (existing) {
      if (selectedThreadId !== existing.threadId) {
        setSelectedThreadId(existing.threadId);
        // Focus composer after a short delay to allow render
        setTimeout(() => composerRef.current?.focus(), 100);
      }
      return;
    }

    // Not found? Create/Ensure thread
    const ensureThread = async () => {
       try {
         const res = await request<{ threadId: string }>('/api/messages/threads', {
           method: 'POST',
           body: JSON.stringify({ athleteId }),
         });
         // Reload threads to pull it in, select it
         await loadThreads(true);
         setSelectedThreadId(res.threadId);
         setTimeout(() => composerRef.current?.focus(), 100);
       } catch (err) {
         console.error('Failed to ensure thread', err);
       }
    };
    
    // Safety check: Only run if we actually have loaded threads (length > 0) or if we tried and got empty.
    // If threads haven't loaded yet (threadsLoading was false but threads is empty, implies initial load hasn't happened or empty list).
    // Better logic: Wait for initial loadThreads to complete.
    // We can rely on `loadThreads` being called by the next useEffect.
    // But we need to know if we *have* loaded.
    // Let's add a `loaded` state.
    // Simplifying: Just let the user click if it doesn't auto-load, but we want auto-load.
    
    // We can add `const [initialLoadDone, setInitialLoadDone] = useState(false);`
  }, [searchParams, threads, threadsLoading, user]); // Note: dependency on threads means it re-runs when threads change, which is good.

  // Mark threads loaded
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const sortedThreads = useMemo(() => {
    const rows = [...threads];
    rows.sort((a, b) => {
      const au = a.unreadCountForCoach ?? 0;
      const bu = b.unreadCountForCoach ?? 0;
      if (au !== bu) return bu - au;
      const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return bt - at;
    });
    return rows;
  }, [threads]);

  const selectedThread = useMemo(() => {
    if (!selectedThreadId) return null;
    return threads.find((t) => t.threadId === selectedThreadId) ?? null;
  }, [selectedThreadId, threads]);

  const loadThreads = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'COACH') return;

      setThreadsLoading(true);
      setThreadsError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<MessageThreadSummary[]>(
          `/api/messages/threads${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setThreads(resp);
        setInitialLoadDone(true);
      } catch (err) {
        setThreadsError(err instanceof Error ? err.message : 'Failed to load notifications.');
      } finally {
        setThreadsLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );
  
  // Revised Deep-link handling with load check
  useEffect(() => {
    const athleteId = searchParams.get('athleteId');
    if (!athleteId || !initialLoadDone || !user || user.role !== 'COACH') return;

    const existing = threads.find((t) => t.athlete.id === athleteId);
    if (existing) {
      if (selectedThreadId !== existing.threadId) {
        setSelectedThreadId(existing.threadId);
        setTimeout(() => composerRef.current?.focus(), 150);
      }
    } else {
        // Only try to create if we haven't selected it yet (avoid loops)
       if (selectedThreadId) return; // If we have a selected thread ID, assume we found it or user clicked something else. 
       // Actually, if selectedThreadId is null, we can try to create.
       
       // Use a ref to prevent double-firing ensureThread?
       // React Effects run twice in strict mode.
       // Let's just fire it.
       const ensure = async () => {
         try {
            const res = await request<{ threadId: string }>('/api/messages/threads', {
                method: 'POST',
                body: JSON.stringify({ athleteId }),
            });
            await loadThreads(true);
            setSelectedThreadId(res.threadId);
            setTimeout(() => composerRef.current?.focus(), 150);
         } catch(e) { /* ignore */ }
       };
       void ensure();
    }
  }, [initialLoadDone, searchParams, threads, user, selectedThreadId]); // Remove loadThreads from deps to avoid cycle if it's not stable (it is stable though)

  const loadMessages = useCallback(
    async (threadId: string, bypassCache = false) => {
      if (!user?.userId || user.role !== 'COACH') return;

      setMessagesLoading(true);
      setMessagesError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<ThreadMessagesResponse>(
          `/api/messages/threads/${threadId}${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );

        // Mark as read for coach.
        await request('/api/messages/mark-read', { method: 'POST', data: { threadId } });

        setMessages(resp.messages);

        // Update the local unread count without forcing a full reload.
        setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, unreadCountForCoach: 0 } : t)));
      } catch (err) {
        setMessagesError(err instanceof Error ? err.message : 'Failed to load messages.');
        setMessages([]);
      } finally {
        setMessagesLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  useEffect(() => {
    if (user?.role === 'COACH') {
      void loadThreads(true);
    }
  }, [loadThreads, user?.role]);

  useEffect(() => {
    if (!selectedThreadId) return;
    void loadMessages(selectedThreadId, true);
  }, [loadMessages, selectedThreadId]);

  useEffect(() => {
    // Default selection: newest unread thread, else newest thread.
    if (selectedThreadId) return;
    if (sortedThreads.length === 0) return;
    const unread = sortedThreads.find((t) => (t.unreadCountForCoach ?? 0) > 0);
    setSelectedThreadId((unread ?? sortedThreads[0])?.threadId ?? null);
  }, [selectedThreadId, sortedThreads]);

  const handleSend = useCallback(async () => {
    if (!selectedThread?.athlete?.id) return;
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    setStatus('');
    setMessagesError('');

    try {
      await request('/api/messages/send', {
        method: 'POST',
        data: { body, recipients: { athleteIds: [selectedThread.athlete.id] } },
      });
      setDraft('');
      setStatus('Sent.');
      if (selectedThreadId) {
        await loadMessages(selectedThreadId, true);
      }
      await loadThreads(true);
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }, [draft, loadMessages, loadThreads, request, selectedThread?.athlete?.id, selectedThreadId]);

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading…</p>;
  }

  if (!user || user.role !== 'COACH') {
    return <p className="text-[var(--muted)]">Coach access required.</p>;
  }

  const displayMessages = [...messages].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <section className={cn("flex flex-col", tokens.spacing.dashboardSectionGap)}>
      <Block>
        <p className={tokens.typography.sectionLabel}>Notifications</p>
        <h1 className={tokens.typography.h1}>Messages</h1>
        <p className={tokens.typography.bodyMuted}>Message your athletes and review unread threads.</p>
      </Block>

      <div className={cn("grid grid-cols-1 min-w-0 lg:grid-cols-3", tokens.spacing.gridGap)}>
        <Block className="lg:col-span-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-4">
            <BlockTitle>Threads</BlockTitle>
            <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => void loadThreads(true)} disabled={threadsLoading}>
              Refresh
            </Button>
          </div>

          {threadsLoading ? <p className={cn("mt-3", tokens.typography.bodyMuted)}>Loading…</p> : null}
          {threadsError ? <p className={cn("mt-3 text-red-700", tokens.typography.body)}>{threadsError}</p> : null}

          <div className="flex flex-col gap-2">
            {sortedThreads.length === 0 && !threadsLoading ? (
              <p className={tokens.typography.bodyMuted}>No messages yet.</p>
            ) : null}

            {sortedThreads.map((t) => {
              const active = t.threadId === selectedThreadId;
              const unread = Math.max(0, t.unreadCountForCoach ?? 0);
              return (
                <button
                  key={t.threadId}
                  type="button"
                  onClick={() => setSelectedThreadId(t.threadId)}
                  className={cn(
                    'w-full rounded-md px-3 py-3 text-left transition-colors border',
                    active
                      ? 'bg-[var(--bg-surface)] border-[var(--ring)] ring-1 ring-[var(--ring)]'
                      : 'bg-transparent border-transparent hover:bg-[var(--bg-surface)] hover:border-[var(--border-subtle)]'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--text)] truncate">{t.athlete.name ?? 'Unnamed athlete'}</div>
                      {t.lastMessagePreview ? (
                        <div className="mt-1 text-xs text-[var(--muted)] truncate">{t.lastMessagePreview}</div>
                      ) : (
                        <div className="mt-1 text-xs text-[var(--muted)]">No messages</div>
                      )}
                    </div>
                    {unread > 0 ? (
                      <div className="flex-shrink-0 rounded-full bg-blue-600/10 px-2 py-1 text-xs font-semibold text-blue-700 tabular-nums">
                        {unread}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Block>

        <Block className="lg:col-span-2 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">{selectedThread?.athlete?.name ?? 'Thread'}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{selectedThreadId ? `Viewing thread` : 'Select a thread'}</p>
            </div>
            {selectedThreadId ? (
              <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => void loadMessages(selectedThreadId, true)} disabled={messagesLoading}>
                Refresh
              </Button>
            ) : null}
          </div>

          <div className="pb-6">
            <Textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={selectedThread ? `Message ${selectedThread.athlete.name ?? 'athlete'}…` : 'Select a thread to message…'}
              disabled={!selectedThread || sending}
              rows={3}
              className="mb-3"
            />
            <div className="flex justify-end">
              <Button type="button" onClick={() => void handleSend()} disabled={!selectedThread || sending || !draft.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>

          <div className="mt-2 text-sm text-[var(--muted)] border-t border-[var(--border-subtle)] pt-4">Messages</div>

          {messagesLoading ? <p className="mt-3 text-sm text-[var(--muted)]">Loading messages…</p> : null}
          {messagesError ? <p className="mt-3 text-sm text-red-700">{messagesError}</p> : null}
          {status ? <p className="mt-3 text-sm text-emerald-700">{status}</p> : null}

          <div className="mt-4 flex flex-col gap-3 max-h-[52vh] overflow-y-auto pr-1">
            {selectedThreadId && displayMessages.length === 0 && !messagesLoading ? (
              <p className="text-sm text-[var(--muted)]">No messages in this thread yet.</p>
            ) : null}

            {displayMessages.map((m) => {
              const isCoach = m.senderRole === 'COACH';
              return (
                <div key={m.id} className={cn('flex', isCoach ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[min(520px,90%)] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words',
                      isCoach ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                    )}
                  >
                    {renderMessageBodyWithLinks(m.body, isCoach)}
                    <div className={cn("mt-1 text-[10px] tabular-nums opacity-70", isCoach ? "text-indigo-100" : "text-slate-500 dark:text-slate-400")}>
                      {new Date(m.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        <div className="hidden">
            {/* Removed footer */}
          </div>
      </Block>
      </div>
    </section>
  );
}
