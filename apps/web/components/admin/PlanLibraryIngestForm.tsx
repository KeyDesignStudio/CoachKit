'use client';
import { useMemo, useState } from 'react';

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

const SEASON_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'BASE', label: 'Base' },
  { value: 'BUILD', label: 'Build' },
  { value: 'PEAK', label: 'Peak' },
  { value: 'TAPER', label: 'Taper' },
  { value: 'WINTER', label: 'Winter' },
  { value: 'IN_SEASON', label: 'In Season' },
] as const;

type ExtractResult = {
  planSource?: {
    id: string;
    title: string;
    storedDocumentUrl?: string | null;
    storedDocumentUploadedAt?: string | null;
  };
  version?: { id: string; version: number };
  extracted?: {
    warnings?: string[];
    confidence?: number;
    weeks?: Array<{ weekIndex: number }>;
    sessions?: Array<{ weekIndex: number; discipline: string; sessionType: string }>;
  };
};

type PlanLibraryIngestFormProps = {
  onIngested?: () => void;
};

export function PlanLibraryIngestForm({ onIngested }: PlanLibraryIngestFormProps) {
  const [type, setType] = useState<'PDF' | 'URL' | 'TEXT'>('PDF');
  const [title, setTitle] = useState('');
  const [sport, setSport] = useState('TRIATHLON');
  const [distance, setDistance] = useState('OTHER');
  const [level, setLevel] = useState('BEGINNER');
  const [durationWeeks, setDurationWeeks] = useState('12');
  const [season, setSeason] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [licenseText, setLicenseText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExtractResult | null>(null);

  const canSubmit = useMemo(() => {
    if (type === 'PDF') return Boolean(file);
    if (type === 'URL') return Boolean(sourceUrl.trim());
    return Boolean(rawText.trim());
  }, [file, rawText, sourceUrl, type]);

  const onSubmit = async () => {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const form = new FormData();
      form.set('type', type);
      form.set('title', title);
      form.set('sport', sport);
      form.set('distance', distance);
      form.set('level', level);
      form.set('durationWeeks', durationWeeks);
      form.set('season', season);
      form.set('author', author);
      form.set('publisher', publisher);
      form.set('licenseText', licenseText);
      form.set('sourceUrl', sourceUrl);
      if (type === 'PDF' && file) {
        form.set('file', file);
      }
      if (type === 'TEXT') {
        form.set('rawText', rawText);
      }

      const res = await fetch('/api/admin/plan-library/ingest', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error?.message || 'Failed to ingest plan source.');
      }

      const payload = (await res.json()) as any;
      setResult(payload?.data ?? payload ?? null);
      onIngested?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ingest plan source.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Step 1</div>
            <h2 className="mt-1 text-lg font-semibold">Ingest Plan Source</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Upload the source and enter the minimum metadata CoachKit needs before parsing it.
            </p>
          </div>
          <div className="rounded-2xl bg-[var(--bg-card)] px-4 py-3 text-xs text-[var(--muted)]">
            Required: title, sport, distance, level, duration, and the source file/text.
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Required metadata</div>
          <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-[var(--muted)]">
            Source type
            <select
              className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as any)}
            >
              <option value="PDF">PDF</option>
              <option value="URL">URL</option>
              <option value="TEXT">TEXT</option>
            </select>
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Title
            <input
              className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Plan name"
            />
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Sport
            <select className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="TRIATHLON">Triathlon</option>
              <option value="DUATHLON">Duathlon</option>
              <option value="RUN">Run</option>
              <option value="BIKE">Bike</option>
              <option value="SWIM">Swim</option>
            </select>
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Distance
            <select className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={distance} onChange={(e) => setDistance(e.target.value)}>
              {DISTANCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Level
            <select className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </select>
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Duration (weeks)
            <input
              className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(e.target.value)}
              inputMode="numeric"
            />
          </label>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Optional metadata</div>
          <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-[var(--muted)]">
            Season
            <select className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={season} onChange={(e) => setSeason(e.target.value)}>
              {SEASON_OPTIONS.map((option) => (
                <option key={option.value || 'blank'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Author
            <input className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Publisher
            <input className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          </label>
        </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Source payload</div>
          <div className="grid gap-3">
          {type === 'PDF' ? (
            <label className="text-xs font-medium text-[var(--muted)]">
              PDF file
              <input
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : null}

          {type === 'URL' ? (
            <label className="text-xs font-medium text-[var(--muted)]">
              Source URL
              <input
                className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>
          ) : null}

          {type === 'TEXT' ? (
            <label className="text-xs font-medium text-[var(--muted)]">
              Raw text
              <textarea
                className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                rows={6}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            </label>
          ) : null}

          <label className="text-xs font-medium text-[var(--muted)]">
            License text (optional)
            <textarea
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
              rows={3}
              value={licenseText}
              onChange={(e) => setLicenseText(e.target.value)}
            />
          </label>
        </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || loading}
            className="rounded-full bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg-page)] disabled:opacity-60"
          >
            {loading ? 'Ingesting…' : 'Ingest & Save'}
          </button>
          <div className="text-xs text-[var(--muted)]">After upload, extraction runs automatically. Review the extracted structure in Source Review Queue before approval.</div>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      </div>

      {result ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Source saved</div>
              <h2 className="mt-1 text-lg font-semibold text-emerald-950">Automatic extraction complete</h2>
              <div className="mt-2 text-sm text-emerald-900">
                Source: {result.planSource?.title} · Version {result.version?.version}
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-xs">
            <div>Weeks detected: {result.extracted?.weeks?.length ?? 0}</div>
            <div>Sessions detected: {result.extracted?.sessions?.length ?? 0}</div>
            <div>Confidence: {result.extracted?.confidence ?? 0}</div>
            <div>
              Stored PDF:{' '}
              {result.planSource?.storedDocumentUrl
                ? `available${result.planSource.storedDocumentUploadedAt ? ` · ${new Date(result.planSource.storedDocumentUploadedAt).toLocaleString()}` : ''}`
                : 'not stored'}
            </div>
            {result.extracted?.warnings?.length ? (
              <ul className="list-disc pl-4 text-amber-600">
                {result.extracted.warnings.map((warning, idx) => (
                  <li key={`warn-${idx}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="mt-4 text-sm text-emerald-900">
            Next: verify weeks/sessions are sensible, fix any bad sessions, then approve the source for APB.
          </div>
        </div>
      ) : null}
    </div>
  );
}
