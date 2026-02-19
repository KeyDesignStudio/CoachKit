'use client';

import { FormEvent, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

type AskCitation = {
  id: string;
  title: string;
  url: string;
  score: number;
};

type AskResponse = {
  answer: string;
  citations: AskCitation[];
};

export function AskFloatingPopup() {
  const { request } = useApi();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AskCitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canAsk = useMemo(() => query.trim().length > 0 && !loading, [query, loading]);

  async function runAsk() {
    if (!query.trim()) return;
    setLoading(true);
    setError('');

    try {
      const data = await request<AskResponse>('/api/knowledge/ask', {
        method: 'POST',
        cache: 'no-store',
        data: {
          query: query.trim(),
        },
      });
      setAnswer(data.answer ?? 'No answer available yet.');
      setCitations(Array.isArray(data.citations) ? data.citations : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed.');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAsk) return;
    void runAsk();
  }

  return (
    <div className="fixed bottom-4 right-4 z-[70]">
      {open ? (
        <div className="absolute bottom-16 right-0 w-[min(25vw,420px)] min-w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="chat" size="sm" className="text-[var(--primary)]" aria-hidden />
              <h2 className="truncate text-xs font-semibold tracking-wide uppercase text-[var(--text)]">Ask AI</h2>
            </div>
            <button
              type="button"
              className="h-8 w-8 rounded-lg text-[var(--muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]"
              onClick={() => setOpen(false)}
              aria-label="Close Ask popup"
              title="Close"
            >
              <Icon name="close" size="sm" aria-hidden />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-3">
            <form onSubmit={onSubmit}>
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (canAsk) {
                      void runAsk();
                    }
                  }
                }}
                placeholder="Ask about athletes, sessions, progress, or risks."
                rows={3}
                className={cn(
                  'w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text)]',
                  'min-h-[88px] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]'
                )}
              />
              <div className="mt-2 text-[11px] text-[var(--muted)]">Press Enter to ask. Shift+Enter for a new line.</div>
            </form>

            {loading ? <p className="mt-3 text-xs text-[var(--muted)]">Thinking…</p> : null}
            {error ? <p className="mt-3 rounded-lg bg-rose-500/10 px-2 py-1.5 text-xs text-rose-700">{error}</p> : null}
            {answer ? <p className="mt-3 text-xs leading-relaxed text-[var(--text)]">{answer}</p> : null}

            {citations.length > 0 ? (
              <div className="mt-3 text-xs">
                <div className="mb-1 text-[var(--muted)]">{citations.length === 1 ? 'Source' : 'Sources'}</div>
                <ul className="list-disc space-y-1 pl-5">
                  {citations.map((citation) => (
                    <li key={citation.id} className="text-[var(--text)]">
                      <a href={citation.url} className="text-[var(--primary)] underline-offset-2 hover:underline">
                        {citation.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="h-12 w-12 rounded-full bg-[var(--primary)] text-white shadow-lg hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        aria-label={open ? 'Close Ask popup' : 'Open Ask popup'}
        title={open ? 'Close Ask' : 'Ask AI'}
      >
        <Icon name="chat" size="md" className="leading-none" aria-hidden />
      </button>
    </div>
  );
}
