'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';
import { formatDisplayInTimeZone } from '@/lib/client-date';

import styles from './CoachChallengeDetailClient.module.css';

type TabKey = 'leaderboard' | 'participants' | 'analytics' | 'settings';

type DetailResponse = {
  challenge: {
    id: string;
    title: string;
    description: string | null;
    status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
    type: string;
    startAt: string;
    endAt: string | null;
    isOngoing: boolean;
    rulesText: string;
    participationConfig: {
      autoJoin: boolean;
      allowLateJoin: boolean;
    };
    rewardConfig: {
      participationBadge: boolean;
      winnerBadges: boolean;
      prizeText: string | null;
    };
  };
  leaderboard: Array<{
    rank: number;
    athleteId: string;
    athleteName: string;
    score: number;
    scoreLabel: string;
    sessions: number;
    deltaToLeaderLabel: string;
    progressPercent: number;
  }>;
  participants: Array<{
    athleteId: string;
    athleteName: string;
    joined: boolean;
  }>;
  analytics: {
    participationPercent: number;
    totalSessionsLogged: number;
    totalVolumeGenerated: number;
    avgSessionsPerAthlete: number;
    previousAvgSessionsPerAthlete: number;
  };
  badges: Array<{
    athleteId: string;
    type: 'PARTICIPATION' | 'GOLD' | 'SILVER' | 'BRONZE';
    awardedAt: string;
  }>;
  featureFlags: {
    canRecalculate: boolean;
    canEdit: boolean;
    canPublish: boolean;
    canArchive: boolean;
    canEndEarly: boolean;
    canExtend: boolean;
  };
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'participants', label: 'Participants' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'settings', label: 'Settings' },
];

function statusTone(status: string) {
  if (status === 'ACTIVE') return 'bg-emerald-500/10 text-emerald-700 border-emerald-300';
  if (status === 'DRAFT') return 'bg-amber-500/10 text-amber-700 border-amber-300';
  if (status === 'COMPLETED') return 'bg-slate-500/10 text-slate-700 border-slate-300';
  return 'bg-zinc-500/10 text-zinc-700 border-zinc-300';
}

export function CoachChallengeDetailClient({ challengeId }: { challengeId: string }) {
  const { request } = useApi();
  const [activeTab, setActiveTab] = useState<TabKey>('leaderboard');
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');

  const previousRanksRef = useRef<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await request<DetailResponse>(`/api/coach/challenges/${encodeURIComponent(challengeId)}`, { cache: 'no-store' });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load challenge.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [challengeId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const rankChangedIds = useMemo(() => {
    const previous = previousRanksRef.current;
    const changed = new Set<string>();
    if (data?.leaderboard) {
      for (const row of data.leaderboard) {
        const prev = previous.get(row.athleteId);
        if (typeof prev === 'number' && prev !== row.rank) changed.add(row.athleteId);
      }
      previous.clear();
      for (const row of data.leaderboard) previous.set(row.athleteId, row.rank);
    }
    return changed;
  }, [data?.leaderboard]);

  const doAction = useCallback(
    async (action: 'PUBLISH' | 'END_EARLY' | 'ARCHIVE' | 'EXTEND_END_DATE', payload?: Record<string, unknown>) => {
      setBusyAction(action);
      setError('');
      try {
        await request(`/api/coach/challenges/${encodeURIComponent(challengeId)}`, {
          method: 'PATCH',
          data: { action, ...(payload ?? {}) },
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to ${action.toLowerCase()}.`);
      } finally {
        setBusyAction('');
      }
    },
    [challengeId, load, request]
  );

  const onRecalculate = useCallback(async () => {
    setBusyAction('RECALCULATE');
    setError('');
    try {
      await request(`/api/coach/challenges/${encodeURIComponent(challengeId)}/recalculate`, {
        method: 'POST',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recalculate.');
    } finally {
      setBusyAction('');
    }
  }, [challengeId, load, request]);

  if (loading && !data) {
    return <p className="text-sm text-[var(--muted)]">Loading challenge...</p>;
  }

  if (!data) {
    return (
      <Block title="Challenge unavailable">
        <p className="text-sm text-[var(--muted)]">{error || 'Could not load challenge.'}</p>
        <div className="mt-3">
          <Link href="/coach/challenges">
            <Button variant="secondary">Back to Challenges</Button>
          </Link>
        </div>
      </Block>
    );
  }

  const csvHref = `/api/coach/challenges/${encodeURIComponent(challengeId)}/leaderboard.csv`;
  const dateRangeLabel = data.challenge.isOngoing
    ? 'Ongoing'
    : `${formatDisplayInTimeZone(data.challenge.startAt, 'UTC')} → ${
        data.challenge.endAt ? formatDisplayInTimeZone(data.challenge.endAt, 'UTC') : 'Ongoing'
      }`;

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
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

        <div className="flex flex-wrap gap-2">
          <Link href="/coach/challenges">
            <Button variant="ghost">Back</Button>
          </Link>
          <Button variant="secondary" disabled={!data.featureFlags.canRecalculate || busyAction === 'RECALCULATE'} onClick={onRecalculate}>
            Recalculate
          </Button>
          <a href={csvHref}>
            <Button variant="secondary">Download CSV</Button>
          </a>
        </div>
      </div>

      {error ? (
        <Block title="Error" className="mb-4 border-rose-200 bg-rose-50 text-rose-800">
          <p className={tokens.typography.bodyMuted}>{error}</p>
        </Block>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-full border px-4 py-2 text-sm transition-colors',
              activeTab === tab.key
                ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg-page)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--bg-structure)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'leaderboard' ? (
        <Block title="Leaderboard">
          {data.leaderboard.length === 0 ? <p className="text-sm text-[var(--muted)]">No participants scored yet.</p> : null}
          <div className="space-y-2">
            {data.leaderboard.map((row) => {
              const rankClass = row.rank === 1 ? styles.top1 : row.rank === 2 ? styles.top2 : row.rank === 3 ? styles.top3 : '';
              const changed = rankChangedIds.has(row.athleteId);
              return (
                <div
                  key={row.athleteId}
                  className={cn(
                    'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3',
                    styles.rankRow,
                    rankClass,
                    changed && styles.rankRowChanged
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-10 text-lg font-semibold text-[var(--text)]">#{row.rank}</span>
                      <span className="font-medium text-[var(--text)]">{row.athleteName}</span>
                    </div>
                    <span className="whitespace-nowrap text-sm text-[var(--muted)]">{row.scoreLabel}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-structure)]">
                    <div className={cn('h-full rounded-full bg-[var(--text)]', styles.progressBar)} style={{ width: `${Math.max(2, row.progressPercent)}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted)]">
                    <span>Sessions: {row.sessions}</span>
                    <span>Delta to leader: {row.deltaToLeaderLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Block>
      ) : null}

      {activeTab === 'participants' ? (
        <Block title="Participants">
          <div className="space-y-2">
            {data.participants.map((row) => (
              <div key={row.athleteId} className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm">
                <span>{row.athleteName}</span>
                <Badge className={row.joined ? 'bg-emerald-500/10 text-emerald-700 border-emerald-300' : ''}>{row.joined ? 'Joined' : 'Eligible'}</Badge>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {activeTab === 'analytics' ? (
        <Block title="Analytics">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <p className="text-xs uppercase text-[var(--muted)]">Participation</p>
              <p className="text-xl font-semibold">{data.analytics.participationPercent}%</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <p className="text-xs uppercase text-[var(--muted)]">Total sessions</p>
              <p className="text-xl font-semibold">{data.analytics.totalSessionsLogged}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <p className="text-xs uppercase text-[var(--muted)]">Total volume</p>
              <p className="text-xl font-semibold">{Math.round(data.analytics.totalVolumeGenerated).toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
              <p className="text-xs uppercase text-[var(--muted)]">Avg sessions / athlete</p>
              <p className="text-xl font-semibold">{data.analytics.avgSessionsPerAthlete.toFixed(2)}</p>
              <p className="text-xs text-[var(--muted)]">Prev period: {data.analytics.previousAvgSessionsPerAthlete.toFixed(2)}</p>
            </div>
          </div>
        </Block>
      ) : null}

      {activeTab === 'settings' ? (
        <Block title="Settings">
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            <Button variant="secondary" disabled={!data.featureFlags.canPublish || busyAction === 'PUBLISH'} onClick={() => void doAction('PUBLISH')}>
              Publish
            </Button>
            <Button variant="secondary" disabled={!data.featureFlags.canEndEarly || busyAction === 'END_EARLY'} onClick={() => void doAction('END_EARLY')}>
              End Early
            </Button>
            <Button variant="secondary" disabled={!data.featureFlags.canArchive || busyAction === 'ARCHIVE'} onClick={() => void doAction('ARCHIVE')}>
              Archive
            </Button>
            <Button
              variant="secondary"
              disabled={!data.featureFlags.canExtend || busyAction === 'EXTEND_END_DATE'}
              onClick={() => {
                const next = window.prompt('Extend end date (YYYY-MM-DD):');
                if (!next) return;
                const nextIso = new Date(`${next}T23:59:59.999Z`).toISOString();
                void doAction('EXTEND_END_DATE', { extendEndAt: nextIso });
              }}
            >
              Extend End Date
            </Button>
          </div>

          <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm text-[var(--muted)]">
            <p>Auto-join: {data.challenge.participationConfig.autoJoin ? 'On' : 'Off'}</p>
            <p>Allow late join: {data.challenge.participationConfig.allowLateJoin ? 'Yes' : 'No'}</p>
            <p>Participation badges: {data.challenge.rewardConfig.participationBadge ? 'On' : 'Off'}</p>
            <p>Winner badges: {data.challenge.rewardConfig.winnerBadges ? 'On' : 'Off'}</p>
            {data.challenge.rewardConfig.prizeText ? <p>Prize: {data.challenge.rewardConfig.prizeText}</p> : null}
          </div>
        </Block>
      ) : null}
    </div>
  );
}
