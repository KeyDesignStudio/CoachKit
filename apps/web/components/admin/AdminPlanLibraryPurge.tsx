'use client';

import { useMemo, useState } from 'react';

import { ApiClientError, useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type PurgeMode = 'SOURCE' | 'HEURISTIC';

type PurgeResult = {
  requestId: string;
  dryRun: boolean;
  mode: PurgeMode;
  matchedCount: number;
  wouldDeleteCount: number;
  deletedCount: number;
  sample: Array<{ id: string; title: string; source: string; externalId: string | null; fingerprint: string | null }>;
  heuristics?: { createdAfter?: string; createdBefore?: string; rules: string[] };
};

type UiError = { code: string; message: string; details?: unknown };

export function AdminPlanLibraryPurge() {
  const { request } = useApi();

  const [mode, setMode] = useState<PurgeMode>('SOURCE');
  const [dryRun, setDryRun] = useState(true);
  const [confirmText, setConfirmText] = useState('');

  const [createdAfter, setCreatedAfter] = useState('');
  const [createdBefore, setCreatedBefore] = useState('');

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [result, setResult] = useState<PurgeResult | null>(null);

  const canApply = useMemo(() => !dryRun && confirmText.trim().toUpperCase() === 'DELETE', [dryRun, confirmText]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const payload: any = {
        dryRun,
        mode,
        sampleLimit: 10,
      };

      if (!dryRun) payload.confirmText = confirmText;

      if (mode === 'HEURISTIC') {
        payload.createdAfter = createdAfter;
        payload.createdBefore = createdBefore;
      }

      const data = await request<PurgeResult>('/api/admin/plan-library/purge-workout-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setResult(data);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError({ code: e.code, message: e.message, details: e.diagnostics });
      } else {
        setError({ code: 'PURGE_FAILED', message: e instanceof Error ? e.message : 'Purge failed' });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-4 md:p-6">
      <div className="text-sm font-semibold text-[var(--text)]">Purge plan-derived Workout Library templates</div>
      <div className="mt-1 text-xs text-[var(--muted)]">
        Safety: dry-run by default. Apply requires typing DELETE. This deletes only WorkoutLibrarySession rows that came from
        plan ingestion; it does not delete CalendarItems.
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-[var(--text)]">Mode</div>
          <Select value={mode} onChange={(e) => setMode(e.target.value as PurgeMode)}>
            <option value="SOURCE">source=PLAN_LIBRARY (recommended)</option>
            <option value="HEURISTIC">heuristic (advanced)</option>
          </Select>
        </div>

        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => {
                setDryRun(e.target.checked);
                if (e.target.checked) setConfirmText('');
              }}
            />
            Dry run
          </label>

          {!dryRun ? (
            <Input placeholder='Type "DELETE" to enable' value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          ) : null}
        </div>

        {mode === 'HEURISTIC' ? (
          <>
            <div>
              <div className="text-xs font-semibold text-[var(--text)]">createdAfter (ISO)</div>
              <Input value={createdAfter} onChange={(e) => setCreatedAfter(e.target.value)} placeholder="2026-01-01T00:00:00.000Z" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--text)]">createdBefore (ISO)</div>
              <Input value={createdBefore} onChange={(e) => setCreatedBefore(e.target.value)} placeholder="2026-01-31T23:59:59.999Z" />
            </div>
          </>
        ) : null}
      </div>

      {!dryRun && !canApply ? <div className="mt-2 text-xs text-amber-700">Type DELETE to enable apply.</div> : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <div className="font-semibold">{error.code}</div>
          <div className="mt-1">{error.message}</div>
          {error.details != null ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px]">details</summary>
              <pre className="mt-2 max-h-[220px] overflow-auto rounded-lg bg-[var(--bg-structure)] p-2 text-[10px] text-[var(--text)]">
                {JSON.stringify(error.details, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button variant={dryRun ? 'secondary' : 'primary'} size="sm" disabled={running || (!dryRun && !canApply)} onClick={() => void run()}>
          {running ? 'Running…' : dryRun ? 'Run Dry-Run' : 'Delete now'}
        </Button>
      </div>

      {result ? (
        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] p-4 text-xs">
          <div className="font-medium text-[var(--text)]">
            requestId={result.requestId} • mode={result.mode} • dryRun={String(result.dryRun)}
          </div>
          <div className="mt-1 text-[var(--muted)]">
            Matched {result.matchedCount} • Would delete {result.wouldDeleteCount}
            {result.dryRun ? '' : ` • Deleted ${result.deletedCount}`}
          </div>

          {result.sample?.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--text)]">Show sample</summary>
              <pre className="mt-2 max-h-[240px] overflow-auto rounded-xl bg-[var(--bg-structure)] p-3 text-[11px] text-[var(--text)]">
                {JSON.stringify(result.sample, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
