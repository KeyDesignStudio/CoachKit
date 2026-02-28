'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { Select } from '@/components/ui/Select';
import { emitFutureSelfEventClient } from '@/lib/future-self-analytics';

type SnapshotResponse = {
  snapshotId: string;
  createdAt: string;
  horizonWeeks: number;
  outputs: {
    headline: string;
    horizons: Record<string, {
      performance: {
        summary: string;
        confidence: { grade: 'A' | 'B' | 'C'; reasons: string[] };
      } | null;
      consistency: {
        summary: string;
        confidence: { grade: 'A' | 'B' | 'C'; reasons: string[] };
      } | null;
      bodyComposition: {
        summary: string;
        confidence: { grade: 'A' | 'B' | 'C'; reasons: string[] };
      } | null;
      disclaimer: string;
    }>;
  };
  assumptions: {
    recencyDaysUsed: number;
    scenario: {
      adherencePct: 70 | 85 | 95;
      volumePct: -10 | 0 | 10;
      intensityMode: 'BASELINE' | 'PLUS_ONE_HARD_SESSION';
      taperDays: 7 | 10 | null;
    };
    notes: string[];
  };
  visibility: {
    performance: boolean;
    consistency: boolean;
    bodyComposition: boolean;
  };
};

const HORIZONS = [4, 8, 12, 24] as const;

export default function CoachAthleteFutureSelfPage() {
  const params = useParams();
  const athleteIdParam = params?.athleteId;
  const athleteId = Array.isArray(athleteIdParam) ? athleteIdParam[0] : String(athleteIdParam ?? '');

  const { request } = useApi();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);

  const [horizonWeeks, setHorizonWeeks] = useState<4 | 8 | 12 | 24>(12);
  const [adherencePct, setAdherencePct] = useState<70 | 85 | 95>(85);
  const [volumePct, setVolumePct] = useState<-10 | 0 | 10>(0);
  const [intensityMode, setIntensityMode] = useState<'BASELINE' | 'PLUS_ONE_HARD_SESSION'>('BASELINE');
  const [taperDays, setTaperDays] = useState<7 | 10>(7);

  const [visibility, setVisibility] = useState({
    performance: true,
    consistency: true,
    bodyComposition: true,
  });

  const loadLatest = useCallback(async () => {
    if (!athleteId) return;
    setLoading(true);
    setError('');
    try {
      const data = await request<{ snapshot: SnapshotResponse | null }>(`/api/projections/latest?athlete_id=${encodeURIComponent(athleteId)}`, {
        cache: 'no-store',
      });
      setSnapshot(data.snapshot);
      if (data.snapshot?.visibility) {
        setVisibility({
          performance: Boolean(data.snapshot.visibility.performance),
          consistency: Boolean(data.snapshot.visibility.consistency),
          bodyComposition: Boolean(data.snapshot.visibility.bodyComposition),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projection.');
    } finally {
      setLoading(false);
    }
  }, [athleteId, request]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  const runProjection = async () => {
    if (!athleteId) return;
    setRunning(true);
    setError('');
    try {
      const created = await request<SnapshotResponse>('/api/projections/run', {
        method: 'POST',
        data: {
          athlete_id: athleteId,
          horizon_weeks: horizonWeeks,
          scenario: {
            adherencePct,
            volumePct,
            intensityMode,
            taperDays,
          },
          visibility,
        },
      });
      setSnapshot(created);
      void emitFutureSelfEventClient('future_self_run_projection', {
        athleteId,
        horizonWeeks,
        adherencePct,
        volumePct,
        intensityMode,
        taperDays,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run projection.');
    } finally {
      setRunning(false);
    }
  };

  const selectedHorizonData = useMemo(() => {
    return snapshot?.outputs?.horizons?.[String(horizonWeeks)] ?? null;
  }, [horizonWeeks, snapshot]);

  const onVisibilityChange = async (key: 'performance' | 'consistency' | 'bodyComposition', next: boolean) => {
    setVisibility((prev) => ({ ...prev, [key]: next }));

    if (!snapshot?.snapshotId) return;

    try {
      await request('/api/projections/visibility', {
        method: 'POST',
        data: {
          athlete_id: athleteId,
          snapshot_id: snapshot.snapshotId,
          visibility: { [key]: next },
        },
      });
      void emitFutureSelfEventClient('future_self_toggle_visibility', {
        athleteId,
        snapshotId: snapshot.snapshotId,
        panel: key,
        visible: next,
      });
    } catch {
      // Keep UI responsive; latest refresh will reconcile.
    }
  };

  const emitScenarioAdjust = (patch: Record<string, unknown>) => {
    void emitFutureSelfEventClient('future_self_adjust_scenario', { athleteId, ...patch });
  };

  const onShareCard = async () => {
    const sharePath = '/athlete/future-self';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`);
      }
    } catch {
      // no-op
    }
    void emitFutureSelfEventClient('future_self_share_card', {
      athleteId,
      snapshotId: snapshot?.snapshotId ?? null,
      sharePath,
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Future Self</h1>
          <p className="text-sm text-[var(--muted)]">Coach-led projection engine with bounded assumptions and confidence bands.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/coach/athletes/${athleteId}/profile`} className="inline-flex min-h-[40px] items-center rounded-md border border-[var(--border-subtle)] px-3 text-sm">
            Back to profile
          </Link>
          <Button type="button" onClick={runProjection} disabled={running || !athleteId}>
            {running ? 'Running...' : 'Run projection'}
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <Block title="Scenario Controls">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <label className="text-sm">
            <div className="mb-1 text-xs text-[var(--muted)]">Horizon</div>
            <Select
              value={String(horizonWeeks)}
              onChange={(e) => {
                const next = Number(e.target.value) as 4 | 8 | 12 | 24;
                setHorizonWeeks(next);
                emitScenarioAdjust({ horizonWeeks: next });
              }}
            >
              {HORIZONS.map((value) => (
                <option key={value} value={value}>{value} weeks</option>
              ))}
            </Select>
          </label>

          <label className="text-sm">
            <div className="mb-1 text-xs text-[var(--muted)]">Adherence</div>
            <Select
              value={String(adherencePct)}
              onChange={(e) => {
                const next = Number(e.target.value) as 70 | 85 | 95;
                setAdherencePct(next);
                emitScenarioAdjust({ adherencePct: next });
              }}
            >
              <option value="70">70%</option>
              <option value="85">85%</option>
              <option value="95">95%</option>
            </Select>
          </label>

          <label className="text-sm">
            <div className="mb-1 text-xs text-[var(--muted)]">Volume</div>
            <Select
              value={String(volumePct)}
              onChange={(e) => {
                const next = Number(e.target.value) as -10 | 0 | 10;
                setVolumePct(next);
                emitScenarioAdjust({ volumePct: next });
              }}
            >
              <option value="-10">-10%</option>
              <option value="0">Baseline</option>
              <option value="10">+10%</option>
            </Select>
          </label>

          <label className="text-sm">
            <div className="mb-1 text-xs text-[var(--muted)]">Intensity</div>
            <Select
              value={intensityMode}
              onChange={(e) => {
                const next = e.target.value as 'BASELINE' | 'PLUS_ONE_HARD_SESSION';
                setIntensityMode(next);
                emitScenarioAdjust({ intensityMode: next });
              }}
            >
              <option value="BASELINE">Baseline</option>
              <option value="PLUS_ONE_HARD_SESSION">+1 hard session/week</option>
            </Select>
          </label>

          <label className="text-sm">
            <div className="mb-1 text-xs text-[var(--muted)]">Taper</div>
            <Select
              value={String(taperDays)}
              onChange={(e) => {
                const next = Number(e.target.value) as 7 | 10;
                setTaperDays(next);
                emitScenarioAdjust({ taperDays: next });
              }}
            >
              <option value="7">7 days</option>
              <option value="10">10 days</option>
            </Select>
          </label>
        </div>
      </Block>

      <Block title="Athlete Visibility">
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={visibility.performance} onChange={(e) => void onVisibilityChange('performance', e.target.checked)} />
            Performance
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={visibility.consistency} onChange={(e) => void onVisibilityChange('consistency', e.target.checked)} />
            Consistency
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={visibility.bodyComposition} onChange={(e) => void onVisibilityChange('bodyComposition', e.target.checked)} />
            Body trend
          </label>
        </div>
      </Block>

      <Block title="Future Self Card">
        {loading ? <p className="text-sm text-[var(--muted)]">Loading latest snapshot...</p> : null}
        {!loading && !snapshot ? <p className="text-sm text-[var(--muted)]">No snapshot yet. Run a projection to generate the first Future Self card.</p> : null}
        {!loading && snapshot && selectedHorizonData ? (
          <div className="space-y-3">
            <div className="text-lg font-semibold">{snapshot.outputs.headline}</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {selectedHorizonData.performance ? <li>{selectedHorizonData.performance.summary}</li> : null}
              {selectedHorizonData.consistency ? <li>{selectedHorizonData.consistency.summary}</li> : null}
              {selectedHorizonData.bodyComposition ? <li>{selectedHorizonData.bodyComposition.summary}</li> : null}
            </ul>
            <div className="rounded-md bg-[var(--bg-structure)] p-3 text-xs text-[var(--muted)]">
              <div>Confidence badge: {snapshot.assumptions.scenario.adherencePct}% adherence scenario</div>
              <div>Assumptions use last {snapshot.assumptions.recencyDaysUsed} days with bounded response curves.</div>
              <div className="mt-1 font-medium text-[var(--text)]">{selectedHorizonData.disclaimer}</div>
            </div>
            <button type="button" onClick={() => void onShareCard()} className="text-sm underline">
              Share card
            </button>
            {' · '}
            <Link href={'/athlete/future-self' as any} className="text-sm underline">
              Open athlete view
            </Link>
          </div>
        ) : null}
      </Block>
    </div>
  );
}
