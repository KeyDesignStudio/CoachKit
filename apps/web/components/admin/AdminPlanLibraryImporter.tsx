
'use client';

import { useEffect, useMemo, useState } from 'react';

import { ApiClientError, useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type Dataset = 'ALL' | 'PLANS' | 'SESSIONS' | 'SCHEDULE';

type ImportStep = {
  dataset: 'PLANS' | 'SESSIONS' | 'SCHEDULE';
  dryRun: boolean;
  scanned: number;
  valid: number;
  wouldCreate: number;
  wouldUpdate: number;
  created: number;
  updated: number;
  errorCount: number;
  errors: Array<{ index: number; code: string; message: string }>;
};

type ImportResult = {
  requestId: string;
  dataset: Dataset;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  steps: ImportStep[];
  message?: string;
};

type ImportUiError = {
  code: string;
  message: string;
  details?: unknown;
};

type PlanLibraryDiagnostics = {
  tables?: Array<{ table: string; exists: boolean; rowCount: number | null }>;
  workoutLibrary?: { planLibrary?: { total?: number } };
};

const DATASETS: Array<{ value: Dataset; label: string }> = [
  { value: 'ALL', label: 'ALL (Plans → Sessions (validate) → Schedule)' },
  { value: 'PLANS', label: 'PLANS' },
  { value: 'SESSIONS', label: 'SESSIONS' },
  { value: 'SCHEDULE', label: 'SCHEDULE' },
];

export function AdminPlanLibraryImporter() {
  const { request } = useApi();

  const [dataset, setDataset] = useState<Dataset>('ALL');
  const [dryRun, setDryRun] = useState(true);
  const [confirmText, setConfirmText] = useState('');

  const [limit, setLimit] = useState('20');
  const [offset, setOffset] = useState('0');

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ImportUiError | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [diag, setDiag] = useState<PlanLibraryDiagnostics | null>(null);
  const [diagError, setDiagError] = useState<ImportUiError | null>(null);

  const parsedLimit = useMemo(() => {
    const n = Number(limit.trim());
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.trunc(n);
  }, [limit]);

  const parsedOffset = useMemo(() => {
    const n = Number(offset.trim());
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.trunc(n);
  }, [offset]);

  const canApply = !dryRun && confirmText.trim().toUpperCase() === 'IMPORT';

  const planTemplateCount = useMemo(() => {
    const n = diag?.tables?.find((t) => t.table === 'PlanTemplate')?.rowCount;
    return typeof n === 'number' ? n : null;
  }, [diag]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setDiagError(null);
        const data = await request<PlanLibraryDiagnostics>('/api/admin/diagnostics/plan-library', {
          method: 'GET',
          cache: 'no-store',
        });
        if (!cancelled) setDiag(data);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setDiagError({ code: e.code, message: e.message, details: e.diagnostics });
        } else {
          setDiagError({ code: 'DIAGNOSTICS_FAILED', message: e instanceof Error ? e.message : 'Diagnostics failed' });
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const payload: any = {
        dataset,
        dryRun,
        confirmApply: dryRun ? false : true,
        offset: parsedOffset,
      };
      if (parsedLimit) payload.limit = parsedLimit;

      const data = await request<ImportResult>('/api/admin/plan-library/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setResult(data);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError({ code: e.code, message: e.message, details: e.diagnostics });
      } else {
        setError({ code: 'IMPORT_FAILED', message: e instanceof Error ? e.message : 'Import failed' });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-4 md:p-6">
      <div className="text-sm font-semibold text-[var(--text)]">Plan Library (Vercel Blob CSV)</div>
      <div className="mt-1 text-xs text-[var(--muted)]">
        Safety: dry-run by default. Turning dry-run off requires typing IMPORT. This import writes only to PlanTemplate and
        PlanTemplateScheduleRow. It does not create or update coach Workout Library templates.
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-[var(--text)]">Dataset</div>
          <Select
            data-testid="admin-plan-library-dataset"
            value={dataset}
            onChange={(e) => setDataset(e.target.value as Dataset)}
          >
            {DATASETS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input
              data-testid="admin-plan-library-dryrun-toggle"
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
            <Input
              data-testid="admin-plan-library-confirm-text"
              placeholder='Type "IMPORT" to enable'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          ) : null}
        </div>

        <div>
          <div className="text-xs font-semibold text-[var(--text)]">Limit</div>
          <Input data-testid="admin-plan-library-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>

        <div>
          <div className="text-xs font-semibold text-[var(--text)]">Offset</div>
          <Input data-testid="admin-plan-library-offset" inputMode="numeric" value={offset} onChange={(e) => setOffset(e.target.value)} />
        </div>
      </div>

      {!dryRun ? (
        <div className="mt-2 text-xs text-amber-700">
          Apply mode will write to the database. Ensure you run a dry-run first.
        </div>
      ) : null}

      {error ? (
        <div
          className={
            error.code === 'PLAN_LIBRARY_DEPENDENCY_MISSING'
              ? 'mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900'
              : 'mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800'
          }
        >
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
        <Button
          data-testid="admin-plan-library-run"
          variant={dryRun ? 'secondary' : 'primary'}
          size="sm"
          disabled={running || (!dryRun && !canApply)}
          onClick={() => void run()}
        >
          {running ? 'Running…' : dryRun ? 'Run Dry-Run' : 'Import Now'}
        </Button>
      </div>

      <div className="mt-3 text-[11px] text-[var(--muted)]">
        Current DB: PlanTemplate={planTemplateCount ?? 'unknown'}
        {diagError ? ` • diagnostics unavailable: ${diagError.code}` : ''}
      </div>

      {result ? (
        <div data-testid="admin-plan-library-result" className="mt-4 rounded-2xl border border-[var(--border-subtle)] p-4">
          <div className="text-sm font-medium text-[var(--text)]">
            requestId={result.requestId} • dataset={result.dataset} • dryRun={String(result.dryRun)}
          </div>
          {result.message ? <div className="mt-1 text-xs text-[var(--muted)]">{result.message}</div> : null}

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {result.steps.map((s) => (
              <div key={s.dataset} className="rounded-xl border border-[var(--border-subtle)] p-3 text-xs">
                <div className="font-semibold text-[var(--text)]">{s.dataset}</div>
                <div className="text-[var(--muted)]">Scanned {s.scanned} • Valid {s.valid}</div>
                <div className="text-[var(--muted)]">
                  {result.dryRun
                    ? `Would create ${s.wouldCreate} / update ${s.wouldUpdate}`
                    : `Created ${s.created} / updated ${s.updated}`}
                </div>
                {s.errorCount > 0 ? (
                  <div className="mt-1 text-red-600">Errors: {s.errorCount} (showing first {s.errors.length})</div>
                ) : (
                  <div className="mt-1 text-green-700">Errors: 0</div>
                )}
              </div>
            ))}
          </div>

          {result.steps.some((s) => s.errorCount > 0) ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[var(--text)]">Show first errors</summary>
              <pre className="mt-2 max-h-[260px] overflow-auto rounded-xl bg-[var(--bg-structure)] p-3 text-[11px] text-[var(--text)]">
                {JSON.stringify(
                  result.steps.flatMap((s) => s.errors.slice(0, 20).map((e) => ({ dataset: s.dataset, ...e }))),
                  null,
                  2
                )}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

    </Card>
  );
}
