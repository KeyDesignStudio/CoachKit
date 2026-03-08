'use client';

import { useMemo, useState } from 'react';

type PlanLibraryImportConsoleProps = {
  onImported?: (jobId: string) => void;
};

type ImportJobPayload = {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  sourceType: 'CSV' | 'XLSX' | 'PDF_ASSIST';
  parseStatsJson: {
    totalRows?: number;
    issueCount?: number;
    hardErrors?: number;
    warnings?: number;
  } | null;
  draftJson: {
    issues?: Array<{ row: number; field: string; severity: 'error' | 'warning'; message: string }>;
  } | null;
  errorJson: { message?: string } | null;
};

const DISTANCE_OPTIONS = [
  { value: 'OTHER', label: 'Other' },
  { value: 'SPRINT', label: 'Sprint' },
  { value: 'OLYMPIC', label: 'Olympic' },
  { value: 'HALF_IRONMAN', label: '70.3 / Half Ironman' },
  { value: 'IRONMAN', label: 'Ironman' },
  { value: 'DUATHLON_STD', label: 'Duathlon Standard' },
  { value: 'DUATHLON_SPRINT', label: 'Duathlon Sprint' },
  { value: 'FIVE_K', label: '5K' },
  { value: 'TEN_K', label: '10K' },
  { value: 'HALF_MARATHON', label: 'Half Marathon' },
  { value: 'MARATHON', label: 'Marathon' },
] as const;

export function PlanLibraryImportConsole({ onImported }: PlanLibraryImportConsoleProps) {
  const [sourceType, setSourceType] = useState<'CSV' | 'XLSX' | 'PDF_ASSIST'>('CSV');
  const [title, setTitle] = useState('');
  const [sport, setSport] = useState('TRIATHLON');
  const [distance, setDistance] = useState('OLYMPIC');
  const [level, setLevel] = useState('BEGINNER');
  const [durationWeeks, setDurationWeeks] = useState('12');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<ImportJobPayload | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

  const canSubmit = useMemo(() => Boolean(file && title.trim()), [file, title]);

  async function handleImport() {
    if (!canSubmit || !file) return;
    setLoading(true);
    setError('');
    setJob(null);
    setCommitMessage('');
    try {
      const form = new FormData();
      form.set('sourceType', sourceType);
      form.set('title', title.trim());
      form.set('sport', sport);
      form.set('distance', distance);
      form.set('level', level);
      form.set('durationWeeks', durationWeeks || '12');
      form.set('author', author);
      form.set('publisher', publisher);
      form.set('file', file);

      const response = await fetch('/api/admin/plan-library/import', { method: 'POST', body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Import failed.');
      }
      const importJob = payload?.data?.importJob as ImportJobPayload;
      setJob(importJob);
      if (importJob?.id) onImported?.(importJob.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCommitDraft() {
    if (!job?.id) return;
    setCommitting(true);
    setCommitMessage('');
    setError('');
    try {
      const response = await fetch(`/api/admin/plan-library/import/${job.id}/commit-draft`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Commit draft failed.');
      }
      setCommitMessage('Draft template committed successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit draft failed.');
    } finally {
      setCommitting(false);
    }
  }

  const rowIssues = job?.draftJson?.issues ?? [];

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Import Console</div>
      <h2 className="mt-1 text-lg font-semibold">Structured-first ingest</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Preferred: CSV/XLSX. PDF Assist creates a draft only and always requires review before publish.
      </p>

      <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs text-[var(--muted)]">
        Required file headers for CSV/XLSX: `weekIndex, dayOfWeek, discipline, sessionType, title, durationMinutes, distanceKm, distanceUnit, notes`.
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium text-[var(--muted)]">
          Source
          <select
            className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as 'CSV' | 'XLSX' | 'PDF_ASSIST')}
          >
            <option value="CSV">CSV (recommended)</option>
            <option value="XLSX">XLSX (recommended)</option>
            <option value="PDF_ASSIST">PDF Assist</option>
          </select>
        </label>
        <label className="text-xs font-medium text-[var(--muted)]">
          Title
          <input className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="text-xs font-medium text-[var(--muted)]">
          Sport
          <select className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={sport} onChange={(event) => setSport(event.target.value)}>
            <option value="TRIATHLON">Triathlon</option>
            <option value="DUATHLON">Duathlon</option>
            <option value="RUN">Run</option>
            <option value="BIKE">Bike</option>
            <option value="SWIM">Swim</option>
          </select>
        </label>
        <label className="text-xs font-medium text-[var(--muted)]">
          Distance
          <select className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={distance} onChange={(event) => setDistance(event.target.value)}>
            {DISTANCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-[var(--muted)]">
          Level
          <select className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="BEGINNER">Beginner</option>
            <option value="INTERMEDIATE">Intermediate</option>
            <option value="ADVANCED">Advanced</option>
          </select>
        </label>
        <label className="text-xs font-medium text-[var(--muted)]">
          Duration (weeks)
          <input className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={durationWeeks} onChange={(event) => setDurationWeeks(event.target.value)} />
        </label>
        <label className="text-xs font-medium text-[var(--muted)]">
          Author
          <input className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={author} onChange={(event) => setAuthor(event.target.value)} />
        </label>
        <label className="text-xs font-medium text-[var(--muted)]">
          Publisher
          <input className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={publisher} onChange={(event) => setPublisher(event.target.value)} />
        </label>
      </div>

      <label className="mt-3 block text-xs font-medium text-[var(--muted)]">
        File
        <input
          type="file"
          accept={sourceType === 'CSV' ? '.csv,text/csv' : sourceType === 'XLSX' ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.pdf,application/pdf'}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleImport}
          disabled={!canSubmit || loading}
          className="rounded-full bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg-page)] disabled:opacity-60"
        >
          {loading ? 'Importing…' : 'Upload & Parse'}
        </button>
        {job?.status === 'COMPLETED' ? (
          <button
            type="button"
            onClick={handleCommitDraft}
            disabled={committing}
            className="rounded-full border border-[var(--border-subtle)] px-4 py-2 text-sm font-medium text-[var(--text)] disabled:opacity-60"
          >
            {committing ? 'Committing…' : 'Commit Draft'}
          </button>
        ) : null}
      </div>

      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {commitMessage ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{commitMessage}</div> : null}

      {job ? (
        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="text-sm font-semibold">Immediate diagnostics</div>
          <div className="mt-2 grid gap-2 text-xs text-[var(--muted)] md:grid-cols-4">
            <div>Status: {job.status}</div>
            <div>Rows: {job.parseStatsJson?.totalRows ?? 0}</div>
            <div>Hard errors: {job.parseStatsJson?.hardErrors ?? 0}</div>
            <div>Warnings: {job.parseStatsJson?.warnings ?? 0}</div>
          </div>
          {job.errorJson?.message ? <div className="mt-2 text-xs text-rose-700">{job.errorJson.message}</div> : null}
          {rowIssues.length ? (
            <div className="mt-3 max-h-52 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
              {rowIssues.slice(0, 60).map((issue, index) => (
                <div key={`${issue.row}-${index}`} className="text-xs text-[var(--muted)]">
                  Row {issue.row} · {issue.field} · {issue.severity}: {issue.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
