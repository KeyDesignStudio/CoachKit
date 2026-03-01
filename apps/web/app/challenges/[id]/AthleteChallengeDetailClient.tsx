'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';
import { formatDisplayInTimeZone } from '@/lib/client-date';

import styles from './AthleteChallengeDetail.module.css';

type DetailResponse = {
  challenge: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    status: 'ACTIVE' | 'COMPLETED' | 'DRAFT' | 'ARCHIVED';
    startAt: string;
    endAt: string | null;
    isOngoing: boolean;
    rulesText: string;
    participationConfig: {
      autoJoin: boolean;
      allowLateJoin: boolean;
    };
  };
  you: {
    rank: number | null;
    score: number;
    scoreLabel: string;
    sessionsCount: number;
    progressPercent: number;
    deltaToLeaderLabel: string;
    joinedAt: string;
  } | null;
  leaderboard: Array<{
    rank: number | null;
    athleteId: string;
    athleteName: string;
    score: number;
    sessionsCount: number;
    scoreLabel: string;
  }>;
  badges: Array<{
    type: 'PARTICIPATION' | 'GOLD' | 'SILVER' | 'BRONZE';
    awardedAt: string;
  }>;
  canJoin: boolean;
  joined: boolean;
};

function statusTone(status: string) {
  if (status === 'ACTIVE') return 'bg-emerald-500/10 text-emerald-700 border-emerald-300';
  if (status === 'COMPLETED') return 'bg-slate-500/10 text-slate-700 border-slate-300';
  return 'bg-zinc-500/10 text-zinc-700 border-zinc-300';
}

function badgeTone(type: DetailResponse['badges'][number]['type']) {
  if (type === 'GOLD') return 'bg-yellow-500/15 text-yellow-700 border-yellow-300';
  if (type === 'SILVER') return 'bg-slate-400/15 text-slate-700 border-slate-300';
  if (type === 'BRONZE') return 'bg-orange-500/15 text-orange-700 border-orange-300';
  return 'bg-emerald-500/10 text-emerald-700 border-emerald-300';
}

export function AthleteChallengeDetailClient({ challengeId }: { challengeId: string }) {
  const { request } = useApi();
  const { user, loading: userLoading } = useAuthUser();
  const router = useRouter();

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);

  const previousRanksRef = useRef<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await request<DetailResponse>(`/api/athlete/challenges/${encodeURIComponent(challengeId)}`, { cache: 'no-store' });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load challenge.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [challengeId, request]);

  useEffect(() => {
    if (!userLoading && user?.role && user.role !== 'ATHLETE') {
      router.replace('/coach/dashboard');
      return;
    }
    if (user?.role === 'ATHLETE') {
      void load();
    }
  }, [load, router, user?.role, userLoading]);

  useEffect(() => {
    if (!data?.badges.length) return;
    setShowConfetti(true);
    const id = window.setTimeout(() => setShowConfetti(false), 1100);
    return () => window.clearTimeout(id);
  }, [data?.badges.length]);

  const rankChangedIds = useMemo(() => {
    const previous = previousRanksRef.current;
    const changed = new Set<string>();
    if (data?.leaderboard) {
      for (const row of data.leaderboard) {
        if (row.rank == null) continue;
        const prev = previous.get(row.athleteId);
        if (typeof prev === 'number' && prev !== row.rank) changed.add(row.athleteId);
      }
      previous.clear();
      for (const row of data.leaderboard) {
        if (row.rank != null) previous.set(row.athleteId, row.rank);
      }
    }
    return changed;
  }, [data?.leaderboard]);

  const onJoin = useCallback(async () => {
    setJoining(true);
    setError('');
    try {
      await request(`/api/athlete/challenges/${encodeURIComponent(challengeId)}/join`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join challenge.');
    } finally {
      setJoining(false);
    }
  }, [challengeId, load, request]);

  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, index) => ({
        left: `${5 + ((index * 19) % 90)}%`,
        delay: `${(index % 6) * 45}ms`,
        color: index % 3 === 0 ? '#facc15' : index % 3 === 1 ? '#94a3b8' : '#f97316',
      })),
    []
  );

  if (loading && !data) return <p className="text-sm text-[var(--muted)]">Loading challenge...</p>;

  if (!data) {
    return (
      <Block title="Challenge unavailable">
        <p className="text-sm text-[var(--muted)]">{error || 'Could not load this challenge.'}</p>
        <div className="mt-3">
          <Link href="/challenges">
            <Button variant="secondary">Back to Challenges</Button>
          </Link>
        </div>
      </Block>
    );
  }

  const topThree = new Set(data.leaderboard.filter((row) => (row.rank ?? 99) <= 3).map((row) => row.athleteId));
  const timeZone = user?.timezone ?? 'UTC';
  const dateRangeLabel = data.challenge.isOngoing
    ? 'Ongoing'
    : `${formatDisplayInTimeZone(data.challenge.startAt, timeZone)} → ${
        data.challenge.endAt ? formatDisplayInTimeZone(data.challenge.endAt, timeZone) : 'Ongoing'
      }`;

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      {showConfetti ? (
        <div className={styles.confettiLayer}>
          {confettiPieces.map((piece, index) => (
            <span
              key={`confetti-${index}`}
              className={styles.confettiPiece}
              style={{ left: piece.left, animationDelay: piece.delay, backgroundColor: piece.color }}
            />
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className={cn('capitalize', statusTone(data.challenge.status))}>{data.challenge.status}</Badge>
            <Badge>{data.challenge.type}</Badge>
            <Badge>{dateRangeLabel}</Badge>
          </div>
          <h1 className={cn(tokens.typography.h1, 'text-[var(--text)]')}>{data.challenge.title}</h1>
          <p className={cn(tokens.typography.bodyMuted, 'mt-1 text-[var(--muted)]')}>{data.challenge.rulesText}</p>
        </div>

        <div className="flex gap-2">
          <Link href="/challenges">
            <Button variant="ghost">Back</Button>
          </Link>
          {data.canJoin ? (
            <Button onClick={onJoin} disabled={joining} aria-busy={joining}>
              Join
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Block title="Error" className="mb-4 border-rose-200 bg-rose-50 text-rose-800">
          <p className={tokens.typography.bodyMuted}>{error}</p>
        </Block>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Block title="Your Rank">
          {data.joined && data.you ? (
            <>
              <p className="text-4xl font-semibold text-[var(--text)]">#{data.you.rank ?? '—'}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{data.you.scoreLabel} • {data.you.sessionsCount} sessions</p>
              <p className="text-xs text-[var(--muted)]">Delta vs leader: {data.you.deltaToLeaderLabel}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-structure)]">
                <div className={cn('h-full rounded-full bg-[var(--text)]', styles.progressBar)} style={{ width: `${Math.max(2, data.you.progressPercent)}%` }} />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--muted)]">Not participating.</p>
              {data.canJoin ? <p className="mt-1 text-xs text-[var(--muted)]">Join to appear on the leaderboard.</p> : null}
            </>
          )}
        </Block>

        <Block title="Badges">
          {data.badges.length ? (
            <div className="flex flex-wrap gap-2">
              {data.badges.map((badge, index) => (
                <Badge key={`${badge.type}-${index}`} className={cn(badgeTone(badge.type), styles.badgePulse)}>
                  {badge.type}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No badges unlocked yet.</p>
          )}
        </Block>
      </div>

      <Block title="Leaderboard" className="mt-4">
        <div className="space-y-2">
          {data.leaderboard.map((row) => (
            <div
              key={row.athleteId}
              className={cn(
                'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2',
                styles.rankRow,
                topThree.has(row.athleteId) ? 'shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]' : '',
                rankChangedIds.has(row.athleteId) && styles.rankRowChanged
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="w-10 text-sm font-semibold">#{row.rank ?? '—'}</span>
                  <span className="truncate text-sm text-[var(--text)]">{row.athleteName}</span>
                </div>
                <span className="whitespace-nowrap text-sm text-[var(--muted)]">{row.scoreLabel}</span>
              </div>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}
