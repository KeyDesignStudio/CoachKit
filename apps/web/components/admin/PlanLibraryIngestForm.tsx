'use client';

import { useMemo, useState } from 'react';

type ExtractResult = {
  planSource?: { id: string; title: string };
  version?: { id: string; version: number };
  extracted?: {
    warnings?: string[];
    confidence?: number;
    weeks?: Array<{ weekIndex: number }>;
    sessions?: Array<{ weekIndex: number; discipline: string; sessionType: string }>;
  };
};

export function PlanLibraryIngestForm() {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ingest plan source.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <h2 className="text-sm font-semibold">Ingest Plan Source</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Upload a PDF, paste a URL, or supply raw text.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-[var(--muted)]">
            Source type
            <select
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
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
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Plan name"
            />
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Sport
            <select className="mt-1 w-full rounded border px-2 py-1 text-sm" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="TRIATHLON">Triathlon</option>
              <option value="DUATHLON">Duathlon</option>
              <option value="RUN">Run</option>
              <option value="BIKE">Bike</option>
              <option value="SWIM">Swim</option>
            </select>
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Distance
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Level
            <select className="mt-1 w-full rounded border px-2 py-1 text-sm" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </select>
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Duration (weeks)
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(e.target.value)}
              inputMode="numeric"
            />
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Season
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="BASE / BUILD / etc"
            />
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Author
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>

          <label className="text-xs font-medium text-[var(--muted)]">
            Publisher
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          </label>
        </div>

        <div className="mt-4 grid gap-3">
          {type === 'PDF' ? (
            <label className="text-xs font-medium text-[var(--muted)]">
              PDF file
              <input
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
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
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
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
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                rows={6}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            </label>
          ) : null}

          <label className="text-xs font-medium text-[var(--muted)]">
            License text (optional)
            <textarea
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              rows={3}
              value={licenseText}
              onChange={(e) => setLicenseText(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || loading}
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {loading ? 'Ingesting…' : 'Ingest & Save'}
          </button>
          {error ? <span className="text-xs text-rose-600">{error}</span> : null}
        </div>
      </div>

      {result ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h2 className="text-sm font-semibold">Extraction preview</h2>
          <div className="mt-2 text-xs text-[var(--muted)]">
            Source: {result.planSource?.title} · Version {result.version?.version}
          </div>
          <div className="mt-3 grid gap-2 text-xs">
            <div>Weeks detected: {result.extracted?.weeks?.length ?? 0}</div>
            <div>Sessions detected: {result.extracted?.sessions?.length ?? 0}</div>
            <div>Confidence: {result.extracted?.confidence ?? 0}</div>
            {result.extracted?.warnings?.length ? (
              <ul className="list-disc pl-4 text-amber-600">
                {result.extracted.warnings.map((warning, idx) => (
                  <li key={`warn-${idx}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
