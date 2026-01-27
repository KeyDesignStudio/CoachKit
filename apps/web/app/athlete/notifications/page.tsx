'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';

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

  const displayMessages = useMemo(() => {
    return [...messages].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [messages]);

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading…</p>;
  }

  if (!user || user.role !== 'ATHLETE') {
    return <p className="text-[var(--muted)]">Athlete access required.</p>;
  }

  return (
    <section className={cn("flex flex-col", tokens.spacing.dashboardSectionGap)}>
      <Block>
        <p className={tokens.typography.sectionLabel}>Notifications</p>
        <h1 className={tokens.typography.h1}>Messages</h1>
        <p className={tokens.typography.bodyMuted}>
          A place to message your coach or leave notes for yourself.
        </p>
      </Block>

      <Block className="min-w-0">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="min-w-0">
            <BlockTitle>Discussion Thread</BlockTitle>
          </div>
          <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => void loadThread(true)} disabled={threadLoading}>
            Refresh
          </Button>
        </div>

        {threadLoading ? <p className={cn("mt-3", tokens.typography.bodyMuted)}>Loading…</p> : null}
        {threadError ? <p className={cn("mt-3 text-red-700", tokens.typography.body)}>{threadError}</p> : null}

        <div className="pb-6">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            disabled={sending}
            rows={3}
            className="mb-3"
          />
          <div className="flex justify-end">
            <Button type="button" onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>

        <div className="mt-2 text-sm text-[var(--muted)] border-t border-[var(--border-subtle)] pt-4">History</div>

        <div className="mt-4 flex flex-col gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {messagesLoading ? <p className="text-sm text-[var(--muted)]">Loading messages…</p> : null}
          {messagesError ? <p className="text-sm text-red-700">{messagesError}</p> : null}
          {status ? <p className="text-sm text-emerald-700">{status}</p> : null}

          {!messagesLoading && threadId && displayMessages.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No messages yet.</p>
          ) : null}

          {displayMessages.map((m) => {
            const isAthlete = m.senderRole === 'ATHLETE';
            return (
              <div key={m.id} className={cn('flex', isAthlete ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[min(520px,90%)] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words',
                    isAthlete ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  )}
                >
                  {m.body}
                  <div className={cn("mt-1 text-[10px] tabular-nums opacity-70", isAthlete ? "text-indigo-100" : "text-slate-500 dark:text-slate-400")}>
                    {new Date(m.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4 hidden">
          {/* Moved to top */}
        </div>
      </Block>
    </section>
  );
}
