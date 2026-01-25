'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
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

export default function AthleteNotificationsPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');

  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [messages, setMessages] = useState<ThreadMessagesResponse['messages']>([]);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  const loadThread = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      setThreadLoading(true);
      setThreadError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<AthleteThreadSummary[]>(
          `/api/messages/threads${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );
        setThreadId(resp[0]?.threadId ?? null);
      } catch (err) {
        setThreadError(err instanceof Error ? err.message : 'Failed to load notifications.');
        setThreadId(null);
      } finally {
        setThreadLoading(false);
      }
    },
    [request, user?.role, user?.userId]
  );

  const loadMessages = useCallback(
    async (tid: string, bypassCache = false) => {
      if (!user?.userId || user.role !== 'ATHLETE') return;

      setMessagesLoading(true);
      setMessagesError('');

      const qs = new URLSearchParams();
      if (bypassCache) qs.set('t', String(Date.now()));

      try {
        const resp = await request<ThreadMessagesResponse>(
          `/api/messages/threads/${tid}${qs.toString() ? `?${qs.toString()}` : ''}`,
          bypassCache ? { cache: 'no-store' } : undefined
        );

        await request('/api/messages/mark-read', { method: 'POST', data: { threadId: tid } });

        setMessages(resp.messages);
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
    if (user?.role === 'ATHLETE') {
      void loadThread(true);
    }
  }, [loadThread, user?.role]);

  useEffect(() => {
    if (!threadId) return;
    void loadMessages(threadId, true);
  }, [loadMessages, threadId]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    setStatus('');
    setMessagesError('');

    try {
      await request('/api/messages/send', { method: 'POST', data: { body } });
      setDraft('');
      setStatus('Sent.');
      if (threadId) {
        await loadMessages(threadId, true);
      } else {
        // Sending creates the thread if missing.
        await loadThread(true);
      }
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }, [draft, loadMessages, loadThread, request, threadId]);

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading…</p>;
  }

  if (!user || user.role !== 'ATHLETE') {
    return <p className="text-[var(--muted)]">Athlete access required.</p>;
  }

  const displayMessages = useMemo(() => {
    return [...messages].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  }, [messages]);

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-white/20 bg-white/40 px-4 py-4 md:px-6 md:py-5 backdrop-blur-3xl shadow-inner">
        <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-[var(--muted)]">Notifications</p>
        <h1 className="text-2xl md:text-3xl font-semibold">Messages</h1>
        <p className="text-xs md:text-sm text-[var(--muted)]">A place to message your coach.</p>
      </header>

      <Card className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Thread</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{threadId ? `Thread ID: ${threadId}` : 'No thread yet'}</p>
          </div>
          <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => void loadThread(true)} disabled={threadLoading}>
            Refresh
          </Button>
        </div>

        {threadLoading ? <p className="mt-3 text-sm text-[var(--muted)]">Loading…</p> : null}
        {threadError ? <p className="mt-3 text-sm text-red-700">{threadError}</p> : null}

        <div className="mt-4 flex flex-col gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {messagesLoading ? <p className="text-sm text-[var(--muted)]">Loading messages…</p> : null}
          {messagesError ? <p className="text-sm text-red-700">{messagesError}</p> : null}
          {status ? <p className="text-sm text-emerald-700">{status}</p> : null}

          {!messagesLoading && threadId && displayMessages.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No messages yet. Say hi!</p>
          ) : null}

          {displayMessages.map((m) => {
            const isAthlete = m.senderRole === 'ATHLETE';
            return (
              <div key={m.id} className={cn('flex', isAthlete ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[min(520px,90%)] rounded-3xl px-4 py-3 text-sm whitespace-pre-wrap break-words',
                    isAthlete ? 'bg-blue-600/10 text-[var(--text)]' : 'bg-[var(--bg-structure)] text-[var(--text)]'
                  )}
                >
                  {m.body}
                  <div className="mt-2 text-[11px] text-[var(--muted)] tabular-nums">
                    {new Date(m.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message your coach…"
            disabled={sending}
            rows={3}
          />
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
