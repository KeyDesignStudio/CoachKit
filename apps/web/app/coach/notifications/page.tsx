'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';

type MailboxItem = {
  id: string;
  threadId: string;
  createdAt: string;
  direction: 'INBOX' | 'SENT';
  subject: string;
  body: string;
  counterpartName: string;
  counterpartId: string;
};

type Recipient = {
  id: string;
  name: string;
  type: 'COACH' | 'ATHLETE' | 'ALL_SQUAD';
};

const SUBJECT_LIMIT = 300;
const BODY_LIMIT = 3000;

export default function CoachNotificationsPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const searchParams = useSearchParams();

  const [mailbox, setMailbox] = useState<MailboxItem[]>([]);
  const [mailboxLoading, setMailboxLoading] = useState(false);
  const [mailboxError, setMailboxError] = useState('');

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientDropdownOpen, setRecipientDropdownOpen] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState<'INBOX' | 'SENT'>('INBOX');
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState('');

  const loadMailbox = useCallback(
    async (bypassCache = false) => {
      if (!user?.userId || user.role !== 'COACH') return;
      setMailboxLoading(true);
      setMailboxError('');
      try {
        const qs = new URLSearchParams();
        if (bypassCache) qs.set('t', String(Date.now()));
        const res = await request<{ items: MailboxItem[] }>(`/api/messages/mailbox${qs.toString() ? `?${qs.toString()}` : ''}`);
        const items = Array.isArray(res?.items) ? res.items : [];
        setMailbox(items);

        // Clear unread badge state by marking inbox threads as read on mailbox open.
        const inboxThreadIds = Array.from(
          new Set(
            items
              .filter((item) => item.direction === 'INBOX')
              .map((item) => String(item.threadId))
              .filter(Boolean)
          )
        );
        if (inboxThreadIds.length > 0) {
          await Promise.all(
            inboxThreadIds.map((threadId) =>
              request('/api/messages/mark-read', {
                method: 'POST',
                data: { threadId },
              }).catch(() => null)
            )
          );
          router.refresh();
        }
      } catch (err) {
        setMailboxError(err instanceof Error ? err.message : 'Failed to load mailbox.');
        setMailbox([]);
      } finally {
        setMailboxLoading(false);
      }
    },
    [request, router, user?.role, user?.userId]
  );

  const loadRecipients = useCallback(async () => {
    if (!user?.userId || user.role !== 'COACH') return;
    setRecipientsLoading(true);
    try {
      const res = await request<{ recipients: Recipient[] }>('/api/messages/recipients', { cache: 'no-store' });
      const rows = Array.isArray(res?.recipients) ? res.recipients : [];
      setRecipients(rows);

      const deepLinkedAthleteId = searchParams.get('athleteId');
      if (deepLinkedAthleteId && rows.some((row) => row.id === deepLinkedAthleteId)) {
        setSelectedRecipientIds([deepLinkedAthleteId]);
      }
    } finally {
      setRecipientsLoading(false);
    }
  }, [request, searchParams, user?.role, user?.userId]);

  useEffect(() => {
    if (user?.role === 'COACH') {
      void Promise.all([loadMailbox(true), loadRecipients()]);
    }
  }, [loadMailbox, loadRecipients, user?.role]);

  const filteredRecipients = useMemo(() => {
    const needle = recipientSearch.trim().toLowerCase();
    if (!needle) return recipients;
    return recipients.filter((row) => row.name.toLowerCase().includes(needle));
  }, [recipientSearch, recipients]);

  const selectedRecipients = useMemo(
    () => recipients.filter((row) => selectedRecipientIds.includes(row.id)),
    [recipients, selectedRecipientIds]
  );

  const visibleItems = useMemo(
    () => mailbox.filter((item) => item.direction === activeTab).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [activeTab, mailbox]
  );
  const visibleItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const allVisibleSelected =
    visibleItemIds.length > 0 && visibleItemIds.every((messageId) => selectedMessageIds.includes(messageId));
  const selectedVisibleCount = visibleItemIds.filter((messageId) => selectedMessageIds.includes(messageId)).length;

  const toggleRecipient = useCallback((recipientId: string) => {
    setSelectedRecipientIds((prev) => {
      if (recipientId === 'ALL_SQUAD') {
        return prev.includes('ALL_SQUAD') ? [] : ['ALL_SQUAD'];
      }

      const withoutAll = prev.filter((id) => id !== 'ALL_SQUAD');
      return withoutAll.includes(recipientId)
        ? withoutAll.filter((id) => id !== recipientId)
        : [...withoutAll, recipientId];
    });
  }, []);

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]
    );
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedMessageIds((prev) => {
      if (visibleItemIds.length === 0) return prev;
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleItemIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleItemIds]));
    });
  }, [allVisibleSelected, visibleItemIds]);

  const deleteSelectedMessages = useCallback(async () => {
    const idsToDelete = visibleItemIds.filter((id) => selectedMessageIds.includes(id));
    if (!idsToDelete.length) return;
    setDeleting(true);
    setMailboxError('');
    setStatus('');
    try {
      await request('/api/messages/bulk-delete', {
        method: 'POST',
        data: { messageIds: idsToDelete },
      });
      setSelectedMessageIds((prev) => prev.filter((id) => !idsToDelete.includes(id)));
      setStatus(idsToDelete.length === 1 ? 'Message deleted.' : `${idsToDelete.length} messages deleted.`);
      await loadMailbox(true);
    } catch (err) {
      setMailboxError(err instanceof Error ? err.message : 'Failed to delete selected messages.');
    } finally {
      setDeleting(false);
    }
  }, [loadMailbox, request, selectedMessageIds, visibleItemIds]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    const trimmedSubject = subject.trim();
    if (!body) return;

    const selected = recipients.filter((row) => selectedRecipientIds.includes(row.id));
    const allSquad = selected.some((row) => row.id === 'ALL_SQUAD');
    const athleteIds = selected.filter((row) => row.type === 'ATHLETE').map((row) => row.id);

    if (!allSquad && athleteIds.length === 0) {
      setMailboxError('Select at least one recipient.');
      return;
    }

    setSending(true);
    setStatus('');
    setMailboxError('');

    try {
      await request('/api/messages/send', {
        method: 'POST',
        data: {
          subject: trimmedSubject || undefined,
          body,
          recipients: allSquad ? { allAthletes: true } : { athleteIds },
        },
      });
      setSubject('');
      setDraft('');
      setComposerOpen(false);
      setRecipientSearch('');
      setRecipientDropdownOpen(false);
      setSelectedRecipientIds([]);
      setStatus('Message sent.');
      await loadMailbox(true);
      setActiveTab('SENT');
    } catch (err) {
      setMailboxError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }, [draft, loadMailbox, recipients, request, selectedRecipientIds, subject]);

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading…</p>;
  }

  if (!user || user.role !== 'COACH') {
    return <p className="text-[var(--muted)]">Coach access required.</p>;
  }

  return (
    <section className={cn('mx-auto flex w-full flex-col xl:w-1/2', tokens.spacing.dashboardSectionGap)}>
      <Block>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={tokens.typography.sectionLabel}>Notifications</p>
            <h1 className={tokens.typography.h1}>Mailbox</h1>
          </div>
          <Button
            type="button"
            className="min-h-[44px]"
            onClick={() => {
              setComposerOpen((prev) => !prev);
              setRecipientDropdownOpen(false);
            }}
          >
            New message
          </Button>
        </div>

        {composerOpen ? (
          <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="relative min-w-0 flex-1">
                <button
                  type="button"
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-left text-sm"
                  onClick={() => setRecipientDropdownOpen((prev) => !prev)}
                >
                  <Icon name="search" size="sm" className="text-[var(--muted)]" />
                  <span className="truncate">
                    {selectedRecipients.length
                      ? selectedRecipients.map((r) => r.name).join(', ')
                      : recipientsLoading
                        ? 'Loading recipients...'
                        : 'Search recipients'}
                  </span>
                  <Icon name="expandMore" size="sm" className="ml-auto text-[var(--muted)]" />
                </button>

                {recipientDropdownOpen ? (
                  <div className="absolute z-20 mt-2 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 shadow-lg">
                    <Input
                      value={recipientSearch}
                      onChange={(e) => setRecipientSearch(e.target.value)}
                      placeholder="Search recipients"
                      className="mb-2"
                    />
                    <div className="max-h-56 overflow-y-auto">
                      {filteredRecipients.map((row) => {
                        const checked = selectedRecipientIds.includes(row.id);
                        return (
                          <label key={row.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-[var(--bg-surface)]">
                            <input type="checkbox" checked={checked} onChange={() => toggleRecipient(row.id)} />
                            <span className="text-sm">{row.name}</span>
                          </label>
                        );
                      })}
                      {!filteredRecipients.length ? (
                        <div className="px-2 py-2 text-sm text-[var(--muted)]">No recipients found.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <button type="button" className="text-[var(--muted)]" onClick={() => setComposerOpen(false)} aria-label="Close compose">
                <Icon name="close" size="md" />
              </button>
            </div>

            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, SUBJECT_LIMIT))}
              placeholder="Enter subject..."
              className="mb-3"
            />
            <div className="mb-1 text-right text-xs text-[var(--muted)]">{subject.length}/{SUBJECT_LIMIT}</div>

            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, BODY_LIMIT))}
              placeholder="Type a message..."
              rows={5}
            />
            <div className="mb-3 text-right text-xs text-[var(--muted)]">{draft.length}/{BODY_LIMIT}</div>

            <Button type="button" onClick={() => void handleSend()} disabled={sending || !draft.trim() || selectedRecipientIds.length === 0}>
              {sending ? 'Sending...' : 'Send'}
            </Button>
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-[var(--border-subtle)]">
          <div className="flex border-b border-[var(--border-subtle)]">
            <button
              type="button"
              className={cn('px-6 py-3 text-sm font-medium', activeTab === 'INBOX' ? 'bg-[var(--bg-card)] text-[var(--text)]' : 'text-[var(--muted)]')}
              onClick={() => {
                setActiveTab('INBOX');
                setSelectedMessageIds([]);
              }}
            >
              Inbox
            </button>
            <button
              type="button"
              className={cn('px-6 py-3 text-sm font-medium', activeTab === 'SENT' ? 'bg-[var(--bg-card)] text-[var(--text)]' : 'text-[var(--muted)]')}
              onClick={() => {
                setActiveTab('SENT');
                setSelectedMessageIds([]);
              }}
            >
              Sent
            </button>
          </div>

          <div className="p-4">
            {mailboxLoading ? <p className="text-sm text-[var(--muted)]">Loading...</p> : null}
            {mailboxError ? <p className="text-sm text-red-700">{mailboxError}</p> : null}
            {status ? <p className="mb-2 text-sm text-emerald-700">{status}</p> : null}

            {!mailboxLoading && visibleItems.length === 0 ? (
              <p className="py-8 text-center text-[var(--muted)]">Your {activeTab === 'INBOX' ? 'Inbox' : 'Sent'} folder is empty</p>
            ) : null}

            {!mailboxLoading && visibleItems.length > 0 ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                  <span>Select all</span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={deleting || selectedVisibleCount === 0}
                  onClick={() => void deleteSelectedMessages()}
                >
                  {deleting ? 'Deleting...' : selectedVisibleCount <= 1 ? 'Delete selected' : `Delete selected (${selectedVisibleCount})`}
                </Button>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {visibleItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedMessageIds.includes(item.id)}
                        onChange={() => toggleMessageSelection(item.id)}
                        aria-label="Select message"
                      />
                      <div className="truncate text-sm font-semibold">
                        {activeTab === 'INBOX' ? `From ${item.counterpartName}` : `To ${item.counterpartName}`}
                      </div>
                    </div>
                    <div className="text-xs tabular-nums text-[var(--muted)]">{new Date(item.createdAt).toLocaleString()}</div>
                  </div>
                  {item.subject ? <div className="mb-1 text-sm font-medium">{item.subject}</div> : null}
                  <div className="whitespace-pre-wrap text-sm text-[var(--text)]">{item.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Block>
    </section>
  );
}
