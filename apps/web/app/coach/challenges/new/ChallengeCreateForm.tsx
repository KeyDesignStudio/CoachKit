'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';

type SquadOption = {
  id: string;
  name: string;
};

type ChallengeTypeValue = 'VOLUME' | 'FREQUENCY' | 'PERFORMANCE' | 'POINTS';

const DISCIPLINES = ['RUN', 'BIKE', 'SWIM', 'STRENGTH', 'BRICK', 'OTHER'] as const;

function toIsoDate(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

export function ChallengeCreateForm({ squads }: { squads: SquadOption[] }) {
  const router = useRouter();
  const { request } = useApi();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [squadId, setSquadId] = useState(squads[0]?.id ?? '');
  const [type, setType] = useState<ChallengeTypeValue>('VOLUME');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isOngoing, setIsOngoing] = useState(false);
  const [disciplineScope, setDisciplineScope] = useState<string[]>([]);

  const [volumeMetric, setVolumeMetric] = useState<'distance' | 'time' | 'elevation'>('distance');
  const [volumeMinDuration, setVolumeMinDuration] = useState('');
  const [includeIndoor, setIncludeIndoor] = useState(true);

  const [frequencyTarget, setFrequencyTarget] = useState('');
  const [frequencyMinDuration, setFrequencyMinDuration] = useState('');

  const [performanceMetric, setPerformanceMetric] = useState<'highest_average_power' | 'fastest_5km' | 'best_pace'>('highest_average_power');
  const [manualApproval, setManualApproval] = useState(false);

  const [autoJoin, setAutoJoin] = useState(true);
  const [allowLateJoin, setAllowLateJoin] = useState(true);

  const [participationBadge, setParticipationBadge] = useState(true);
  const [winnerBadges, setWinnerBadges] = useState(true);
  const [prizeText, setPrizeText] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const scoringConfig = useMemo(() => {
    if (type === 'VOLUME') {
      return {
        metric: volumeMetric,
        minSessionDurationMinutes: volumeMinDuration ? Number(volumeMinDuration) : null,
        includeIndoor,
      };
    }

    if (type === 'FREQUENCY') {
      return {
        metric: 'sessions_completed',
        targetCount: frequencyTarget ? Number(frequencyTarget) : null,
        minSessionDurationMinutes: frequencyMinDuration ? Number(frequencyMinDuration) : null,
      };
    }

    if (type === 'PERFORMANCE') {
      return {
        metric: performanceMetric,
        manualApproval,
      };
    }

    return { metric: 'points' };
  }, [type, volumeMetric, volumeMinDuration, includeIndoor, frequencyTarget, frequencyMinDuration, performanceMetric, manualApproval]);

  async function submit(status: 'DRAFT' | 'ACTIVE') {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    if (!startDate) {
      setError('Start date is required.');
      return;
    }

    if (!isOngoing && !endDate) {
      setError('End date is required unless ongoing is enabled.');
      return;
    }

    if (!squadId) {
      setError('Select a squad.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await request('/api/coach/challenges', {
        method: 'POST',
        data: {
          title,
          description: description.trim() || null,
          squadId,
          type,
          startAt: toIsoDate(startDate),
          endAt: isOngoing ? null : toIsoDate(endDate),
          isOngoing,
          disciplineScope,
          scoringConfig,
          participationConfig: {
            autoJoin,
            allowLateJoin,
          },
          rewardConfig: {
            participationBadge,
            winnerBadges,
            prizeText: prizeText.trim() || null,
          },
          status,
          notifySquad: status === 'ACTIVE',
        },
      });

      router.push('/coach/challenges');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save challenge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl pb-12">
      <div className="mb-4">
        <h1 className={cn(tokens.typography.h1, 'text-[var(--text)]')}>Create Challenge</h1>
        <p className={cn(tokens.typography.bodyMuted, 'text-[var(--muted)]')}>Set up and publish in under two minutes.</p>
      </div>

      {error ? (
        <Block title="Error" className="mb-4 border-rose-200 bg-rose-50 text-rose-800">
          <p className={tokens.typography.bodyMuted}>{error}</p>
        </Block>
      ) : null}

      <div className="space-y-4">
        <Block title="Basic Info">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm text-[var(--muted)]">Title *</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="March Squad Volume Push" />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm text-[var(--muted)]">Description</span>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-[var(--muted)]">Type *</span>
              <Select value={type} onChange={(event) => setType(event.target.value as ChallengeTypeValue)}>
                <option value="VOLUME">Volume</option>
                <option value="FREQUENCY">Frequency</option>
                <option value="PERFORMANCE">Performance</option>
                <option value="POINTS">Points (future-ready)</option>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-sm text-[var(--muted)]">Squad *</span>
              <Select value={squadId} onChange={(event) => setSquadId(event.target.value)}>
                {squads.map((squad) => (
                  <option key={squad.id} value={squad.id}>
                    {squad.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </Block>

        <Block title="Timing">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm text-[var(--muted)]">Start date *</span>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-[var(--muted)]">End date</span>
              <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={isOngoing} />
            </label>
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" checked={isOngoing} onChange={(event) => setIsOngoing(event.target.checked)} />
              <span className="text-sm text-[var(--text)]">Ongoing (no end date)</span>
            </label>
          </div>
        </Block>

        <Block title="Scope">
          <p className="mb-2 text-sm text-[var(--muted)]">Discipline filter</p>
          <div className="flex flex-wrap gap-2">
            {DISCIPLINES.map((discipline) => {
              const selected = disciplineScope.includes(discipline);
              return (
                <button
                  key={discipline}
                  type="button"
                  onClick={() =>
                    setDisciplineScope((prev) =>
                      prev.includes(discipline) ? prev.filter((value) => value !== discipline) : [...prev, discipline]
                    )
                  }
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm',
                    selected
                      ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg-page)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text)]'
                  )}
                >
                  {discipline}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">No selection means all disciplines.</p>
        </Block>

        <Block title="Rules">
          {type === 'VOLUME' ? (
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Metric</span>
                <Select value={volumeMetric} onChange={(event) => setVolumeMetric(event.target.value as any)}>
                  <option value="distance">Distance</option>
                  <option value="time">Time</option>
                  <option value="elevation">Elevation</option>
                </Select>
              </label>
              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Min session duration (min)</span>
                <Input type="number" min={0} value={volumeMinDuration} onChange={(event) => setVolumeMinDuration(event.target.value)} />
              </label>
              <label className="flex items-end gap-2 pb-2">
                <input type="checkbox" checked={includeIndoor} onChange={(event) => setIncludeIndoor(event.target.checked)} />
                <span className="text-sm text-[var(--text)]">Include indoor</span>
              </label>
            </div>
          ) : null}

          {type === 'FREQUENCY' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Target session count</span>
                <Input type="number" min={1} value={frequencyTarget} onChange={(event) => setFrequencyTarget(event.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Min duration (min)</span>
                <Input type="number" min={0} value={frequencyMinDuration} onChange={(event) => setFrequencyMinDuration(event.target.value)} />
              </label>
            </div>
          ) : null}

          {type === 'PERFORMANCE' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Metric</span>
                <Select value={performanceMetric} onChange={(event) => setPerformanceMetric(event.target.value as any)}>
                  <option value="highest_average_power">Highest average power</option>
                  <option value="fastest_5km">Fastest 5km</option>
                  <option value="best_pace">Best pace</option>
                </Select>
              </label>
              <label className="flex items-end gap-2 pb-2">
                <input type="checkbox" checked={manualApproval} onChange={(event) => setManualApproval(event.target.checked)} />
                <span className="text-sm text-[var(--text)]">Manual approval required</span>
              </label>
            </div>
          ) : null}
        </Block>

        <Block title="Participation">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={autoJoin} onChange={(event) => setAutoJoin(event.target.checked)} />
              <span className="text-sm">Auto-join athletes</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allowLateJoin} onChange={(event) => setAllowLateJoin(event.target.checked)} disabled={autoJoin} />
              <span className="text-sm">Allow late join</span>
            </label>
          </div>
        </Block>

        <Block title="Rewards">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={participationBadge} onChange={(event) => setParticipationBadge(event.target.checked)} />
              <span className="text-sm">Participation badge</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={winnerBadges} onChange={(event) => setWinnerBadges(event.target.checked)} />
              <span className="text-sm">Winner badges (Gold/Silver/Bronze)</span>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm text-[var(--muted)]">Prize text</span>
              <Input value={prizeText} onChange={(event) => setPrizeText(event.target.value)} placeholder="e.g. Team kit voucher" />
            </label>
          </div>
        </Block>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => router.push('/coach/challenges')} disabled={busy}>Cancel</Button>
        <Button variant="secondary" onClick={() => void submit('DRAFT')} disabled={busy}>Save Draft</Button>
        <Button onClick={() => void submit('ACTIVE')} disabled={busy} aria-busy={busy}>Publish</Button>
      </div>
    </div>
  );
}
