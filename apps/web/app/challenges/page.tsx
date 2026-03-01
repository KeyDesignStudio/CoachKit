'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';

type AthleteChallengeCard = {
  id: string;
  title: string;
  type: string;
  status: 'ACTIVE' | 'COMPLETED' | 'DRAFT' | 'ARCHIVED';
  dateRangeLabel: string;
  rulesText: string;
  participantCount: number;
  joined: boolean;
  canJoin: boolean;
  yourRank: number | null;
  yourScoreLabel: string | null;
  yourSessions: number;
  top3: Array<{
    rank: number | null;
    athleteName: string;
    scoreLabel: string;
  }>;
};

function statusTone(status: AthleteChallengeCard['status']) {
  if (status === 'ACTIVE') return 'bg-emerald-500/10 text-emerald-700 border-emerald-300';
  if (status === 'COMPLETED') return 'bg-slate-500/10 text-slate-700 border-slate-300';
  if (status === 'DRAFT') return 'bg-amber-500/10 text-amber-700 border-amber-300';
  return 'bg-zinc-500/10 text-zinc-700 border-zinc-300';
}

export default function AthleteChallengesPage() {
  const { user, loading: userLoading } = useAuthUser();
  const router = useRouter();
  const { request } = useApi();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [challenges, setChallenges] = useState<AthleteChallengeCard[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await request<{ challenges: AthleteChallengeCard[] }>('/api/athlete/challenges', { cache: 'no-store' });
      setChallenges(Array.isArray(res.challenges) ? res.challenges : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load challenges.');
      setChallenges([]);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (!userLoading && user?.role && user.role !== 'ATHLETE') {
      router.replace('/coach/dashboard');
      return;
    }
    if (user?.role === 'ATHLETE') {
      void load();
    }
  }, [load, router, user?.role, userLoading]);

  const active = useMemo(() => challenges.filter((challenge) => challenge.status === 'ACTIVE'), [challenges]);
  const completed = useMemo(() => challenges.filter((challenge) => challenge.status === 'COMPLETED'), [challenges]);

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <div className="mb-4">
        <h1 className={cn(tokens.typography.h1, 'text-[var(--text)]')}>Challenges</h1>
        <p className={cn(tokens.typography.bodyMuted, 'text-[var(--muted)]')}>Track your rank, progress, and squad momentum.</p>
      </div>

      {error ? (
        <Block title="Error" className="mb-4 border-rose-200 bg-rose-50 text-rose-800">
          <p className={tokens.typography.bodyMuted}>{error}</p>
        </Block>
      ) : null}

      {loading ? <p className="text-sm text-[var(--muted)]">Loading challenges...</p> : null}

      {!loading && challenges.length === 0 ? (
        <Block title="No active challenges">
          <p className={cn(tokens.typography.bodyMuted, 'text-[var(--muted)]')}>No challenges are currently available for your squad.</p>
        </Block>
      ) : null}

      {active.length > 0 ? (
        <div className="mb-6 space-y-3">
          <h2 className={cn(tokens.typography.h2, 'text-[var(--text)]')}>Active</h2>
          {active.map((challenge) => (
            <Block key={challenge.id} title={challenge.title}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className={cn('capitalize', statusTone(challenge.status))}>{challenge.status}</Badge>
                <Badge>{challenge.type}</Badge>
                {challenge.joined ? <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-300">Participating</Badge> : null}
                {!challenge.joined ? <Badge>Not participating</Badge> : null}
              </div>

              <p className="text-sm text-[var(--muted)]">{challenge.dateRangeLabel}</p>
              <p className="mt-1 text-sm text-[var(--text)]">{challenge.rulesText}</p>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <p className="text-xs uppercase text-[var(--muted)]">Your rank</p>
                  <p className="text-xl font-semibold">{challenge.joined ? `#${challenge.yourRank ?? '—'}` : '—'}</p>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <p className="text-xs uppercase text-[var(--muted)]">Your score</p>
                  <p className="text-xl font-semibold">{challenge.joined ? challenge.yourScoreLabel ?? '0' : 'Join to start'}</p>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                  <p className="text-xs uppercase text-[var(--muted)]">Participants</p>
                  <p className="text-xl font-semibold">{challenge.participantCount}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/challenges/${encodeURIComponent(challenge.id)}`}>
                  <Button size="sm">View</Button>
                </Link>
                {!challenge.joined && challenge.canJoin ? (
                  <Link href={`/challenges/${encodeURIComponent(challenge.id)}`}>
                    <Button variant="secondary" size="sm">Join</Button>
                  </Link>
                ) : null}
              </div>
            </Block>
          ))}
        </div>
      ) : null}

      {completed.length > 0 ? (
        <div className="space-y-3">
          <h2 className={cn(tokens.typography.h2, 'text-[var(--text)]')}>Completed</h2>
          {completed.map((challenge) => (
            <Block key={challenge.id} title={challenge.title}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge className={cn('capitalize', statusTone(challenge.status))}>{challenge.status}</Badge>
                {challenge.joined ? <Badge>Final rank #{challenge.yourRank ?? '—'}</Badge> : null}
              </div>
              <p className="text-sm text-[var(--muted)]">{challenge.dateRangeLabel}</p>
              <div className="mt-2">
                <Link href={`/challenges/${encodeURIComponent(challenge.id)}`}>
                  <Button variant="secondary" size="sm">View Result</Button>
                </Link>
              </div>
            </Block>
          ))}
        </div>
      ) : null}
    </div>
  );
}
