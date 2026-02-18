'use client';

import { FormEvent, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { tokens } from '@/components/ui/tokens';
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

export function AskCard() {
  const { request } = useApi();

  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AskCitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSearch = useMemo(() => query.trim().length > 0 && !loading, [query, loading]);

  async function runSearch() {
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
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSearch) return;
    void runSearch();
  }

  return (
    <Block
      title="Ask"
      showHeaderDivider={false}
      className="w-full"
      rightAction={
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setAnswer('');
            setCitations([]);
            setError('');
          }}
          className="text-[var(--muted)] hover:text-[var(--text)] text-base leading-none"
          aria-label="Clear ask"
          title="Clear"
        >
          ×
        </button>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (canSearch) {
                void runSearch();
              }
            }
          }}
          placeholder="Ask in natural language about athletes, workouts, progress, or risks."
          rows={3}
          className={cn(
            'w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text)] resize-y min-h-[100px]',
            tokens.spacing.elementPadding,
            tokens.typography.body
          )}
        />

        <Button type="submit" disabled={!canSearch} className="min-h-[44px] min-w-[140px]">
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error ? (
        <div className={cn('mt-3 rounded-xl bg-rose-500/10 text-rose-700', tokens.spacing.elementPadding, tokens.typography.body)}>
          {error}
        </div>
      ) : null}

      {answer ? <p className={cn('mt-4 text-[var(--text)]', tokens.typography.body)}>{answer}</p> : null}

      {citations.length > 0 ? (
        <div className={cn('mt-3', tokens.typography.meta)}>
          <div className="text-[var(--muted)] mb-1">{citations.length === 1 ? 'Source' : 'Sources'}</div>
          <ul className="list-disc pl-6 space-y-1">
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
    </Block>
  );
}
