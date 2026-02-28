'use client';

import { useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Block } from '@/components/ui/Block';
import { Select } from '@/components/ui/Select';
import { emitFutureSelfEventClient } from '@/lib/future-self-analytics';

type AthleteSnapshotResponse = {
  snapshotId: string;
  createdAt: string;
  outputs: {
    headline: string;
    horizons: Record<string, {
      performance?: { summary: string; confidence: { grade: 'A' | 'B' | 'C' } } | null;
      consistency?: { summary: string; confidence: { grade: 'A' | 'B' | 'C' } } | null;
      bodyComposition?: { summary: string; confidence: { grade: 'A' | 'B' | 'C' } } | null;
      disclaimer: string;
    }>;
  };
  assumptions: {
    notes: string[];
  };
};

const HORIZONS = [4, 8, 12, 24] as const;

export default function AthleteFutureSelfPage() {
  const { request } = useApi();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<AthleteSnapshotResponse | null>(null);
  const [horizonWeeks, setHorizonWeeks] = useState<4 | 8 | 12 | 24>(12);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await request<{ snapshot: AthleteSnapshotResponse | null }>('/api/projections/latest', { cache: 'no-store' });
        setSnapshot(data.snapshot);
        if (data.snapshot) {
          void emitFutureSelfEventClient('future_self_view', {
            snapshotId: data.snapshot.snapshotId,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projection.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [request]);

  const horizon = useMemo(() => snapshot?.outputs?.horizons?.[String(horizonWeeks)] ?? null, [horizonWeeks, snapshot]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Your Future Self</h1>
        <p className="text-sm text-[var(--muted)]">Based on your coach&apos;s plan and your recent training, here is your most likely direction.</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Projections are estimates, not guarantees.</p>
      </div>

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <Block title="Timeline">
        <label className="text-sm">
          <div className="mb-1 text-xs text-[var(--muted)]">Projection horizon</div>
          <Select
            value={String(horizonWeeks)}
            onChange={(e) => {
              const next = Number(e.target.value) as 4 | 8 | 12 | 24;
              setHorizonWeeks(next);
              void emitFutureSelfEventClient('future_self_change_horizon', { horizonWeeks: next });
            }}
          >
            {HORIZONS.map((value) => (
              <option key={value} value={value}>{value} weeks</option>
            ))}
          </Select>
        </label>
      </Block>

      <Block title="Future Self Card">
        {loading ? <p className="text-sm text-[var(--muted)]">Loading...</p> : null}
        {!loading && !snapshot ? <p className="text-sm text-[var(--muted)]">Your coach has not shared a Future Self snapshot yet.</p> : null}
        {!loading && snapshot && horizon ? (
          <div className="space-y-3">
            <div className="text-lg font-semibold">{snapshot.outputs.headline}</div>
            {horizon.performance ? <p className="text-sm">{horizon.performance.summary}</p> : null}
            {horizon.consistency ? <p className="text-sm">{horizon.consistency.summary}</p> : null}
            {horizon.bodyComposition ? <p className="text-sm">{horizon.bodyComposition.summary}</p> : null}
            <div className="rounded-md bg-[var(--bg-structure)] p-3 text-xs text-[var(--muted)]">
              <div>What this means: likely range if consistency stays similar.</div>
              <div>What affects it: consistency, volume, and session quality under your coach plan.</div>
              <div>Assumptions: {snapshot.assumptions.notes[0] ?? 'Conservative progression with uncertainty bands.'}</div>
              <div className="mt-1 font-medium text-[var(--text)]">{horizon.disclaimer}</div>
            </div>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => {
                const next = !assumptionsOpen;
                setAssumptionsOpen(next);
                if (next) {
                  void emitFutureSelfEventClient('future_self_open_assumptions', {
                    snapshotId: snapshot.snapshotId,
                    horizonWeeks,
                  });
                }
              }}
            >
              Why this range?
            </button>
            {assumptionsOpen ? (
              <div className="rounded-md border border-[var(--border-subtle)] p-3 text-sm">
                {(snapshot.assumptions.notes ?? []).map((note, index) => (
                  <div key={`${note}-${index}`}>{note}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Block>
    </div>
  );
}
