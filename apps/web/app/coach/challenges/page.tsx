'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChallengeStatus } from '@prisma/client';

import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { Badge } from '@/components/ui/Badge';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';

type ChallengeCard = {
  id: string;
  title: string;
  type: string;
  status: ChallengeStatus;
  dateRangeLabel: string;
  participationCount: number;
  rulesText: string;
  squad: {
    id: string;
    name: string;
  };
  top3: Array<{
    athleteId: string;
    athleteName: string;
    rank: number | null;
    scoreLabel: string;
  }>;
};

const FILTERS: Array<{ label: string; value: 'ALL' | ChallengeStatus }> = [
  { label: 'Active', value: ChallengeStatus.ACTIVE },
  { label: 'Draft', value: ChallengeStatus.DRAFT },
  { label: 'Completed', value: ChallengeStatus.COMPLETED },
  { label: 'Archived', value: ChallengeStatus.ARCHIVED },
  { label: 'All', value: 'ALL' },
];

function statusTone(status: ChallengeStatus) {
  if (status === ChallengeStatus.ACTIVE) return 'bg-emerald-500/10 text-emerald-700 border-emerald-200';
  if (status === ChallengeStatus.DRAFT) return 'bg-amber-500/10 text-amber-700 border-amber-200';
  if (status === ChallengeStatus.COMPLETED) return 'bg-slate-500/10 text-slate-700 border-slate-300';
  return 'bg-zinc-500/10 text-zinc-700 border-zinc-300';
}

export default function CoachChallengesPage() {
  const { request } = useApi();
  const [filter, setFilter] = useState<'ALL' | ChallengeStatus>(ChallengeStatus.ACTIVE);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [challenges, setChallenges] = useState<ChallengeCard[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (filter !== 'ALL') qs.set('status', filter);
      const res = await request<{ challenges: ChallengeCard[] }>(`/api/coach/challenges?${qs.toString()}`, { cache: 'no-store' });
      setChallenges(Array.isArray(res.challenges) ? res.challenges : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load challenges.');
      setChallenges([]);
    } finally {
      setLoading(false);
    }
  }, [filter, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => challenges, [challenges]);

  const onDuplicate = useCallback(
    async (challengeId: string) => {
      setBusyId(challengeId);
      setError('');
      try {
        await request(`/api/coach/challenges/${encodeURIComponent(challengeId)}/duplicate`, { method: 'POST' });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to duplicate challenge.');
      } finally {
        setBusyId(null);
      }
    },
    [load, request]
  );

  const onEndEarly = useCallback(
    async (challengeId: string) => {
      setBusyId(challengeId);
      setError('');
      try {
        await request(`/api/coach/challenges/${encodeURIComponent(challengeId)}`, {
          method: 'PATCH',
          data: { action: 'END_EARLY' },
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to end challenge early.');
      } finally {
        setBusyId(null);
      }
    },
    [load, request]
  );

  const onArchive = useCallback(
    async (challengeId: string) => {
      setBusyId(challengeId);
      setError('');
      try {
        await request(`/api/coach/challenges/${encodeURIComponent(challengeId)}`, {
          method: 'PATCH',
          data: { action: 'ARCHIVE' },
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to archive challenge.');
      } finally {
        setBusyId(null);
      }
    },
    [load, request]
  );

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={cn(tokens.typography.h1, 'text-[var(--text)]')}>Challenges</h1>
          <p className={cn(tokens.typography.bodyMuted, 'text-[var(--muted)]')}>Run concurrent squad challenges with leaderboards and badges.</p>
        </div>
        <Link href="/coach/challenges/new">
          <Button>Create Challenge</Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={cn(
              'rounded-full border px-4 py-2 text-sm transition-colors',
              filter === option.value
                ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg-page)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--bg-structure)]'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <Block title="Error" className="mb-4 border-rose-200 bg-rose-50 text-rose-800">
          <p className={tokens.typography.bodyMuted}>{error}</p>
        </Block>
      ) : null}

      {loading ? <p className="text-sm text-[var(--muted)]">Loading challenges...</p> : null}

      {!loading && visible.length === 0 ? (
        <Block title="No challenges yet">
          <p className={cn(tokens.typography.body, 'text-[var(--muted)]')}>No challenges yet. Create your first squad challenge.</p>
        </Block>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((challenge) => {
          const isBusy = busyId === challenge.id;
          return (
            <Block key={challenge.id} title={challenge.title} className="relative overflow-hidden">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className={cn('capitalize', statusTone(challenge.status))}>{challenge.status}</Badge>
                <Badge>{challenge.type}</Badge>
                <Badge>{challenge.squad.name}</Badge>
              </div>

              <div className="space-y-2 text-sm">
                <p className="text-[var(--muted)]">{challenge.dateRangeLabel}</p>
                <p className="text-[var(--text)]">{challenge.rulesText}</p>
                <p className="text-[var(--muted)]">Participants: {challenge.participationCount}</p>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">Top 3</p>
                {challenge.top3.length ? (
                  <ul className="space-y-2 text-sm">
                    {challenge.top3.map((row) => (
                      <li key={`${challenge.id}-${row.athleteId}`} className="flex items-center justify-between gap-2">
                        <span className="truncate text-[var(--text)]">#{row.rank} {row.athleteName}</span>
                        <span className="whitespace-nowrap text-[var(--muted)]">{row.scoreLabel}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--muted)]">No scores yet.</p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link href={`/coach/challenges/${encodeURIComponent(challenge.id)}`}>
                  <Button variant="secondary" className="w-full" size="sm">View</Button>
                </Link>
                <Link href={`/coach/challenges/${encodeURIComponent(challenge.id)}`}>
                  <Button variant="ghost" className="w-full" size="sm">Edit</Button>
                </Link>
                <Button variant="ghost" size="sm" className="w-full" disabled={isBusy} onClick={() => onDuplicate(challenge.id)}>
                  Duplicate
                </Button>
                <Button variant="ghost" size="sm" className="w-full" disabled={isBusy || challenge.status !== ChallengeStatus.ACTIVE} onClick={() => onEndEarly(challenge.id)}>
                  End Early
                </Button>
                <Button variant="ghost" size="sm" className="col-span-2 w-full" disabled={isBusy || challenge.status === ChallengeStatus.ARCHIVED} onClick={() => onArchive(challenge.id)}>
                  Archive
                </Button>
              </div>
            </Block>
          );
        })}
      </div>
    </div>
  );
}
