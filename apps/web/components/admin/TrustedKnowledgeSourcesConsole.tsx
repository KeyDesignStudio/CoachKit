'use client';

import { useEffect, useState } from 'react';

type TrustedSource = {
  id: string;
  title: string;
  authority: string;
  category: string;
  url: string;
  trustTier: number;
  planningEnabled: boolean;
  qaEnabled: boolean;
  citationRequired: boolean;
  isActive: boolean;
  summaryText: string | null;
  tags: string[];
};

export function TrustedKnowledgeSourcesConsole() {
  const [sources, setSources] = useState<TrustedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/knowledge-sources', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load trusted sources.');
      setSources((payload?.data?.sources ?? []) as TrustedSource[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trusted sources.');
      setSources([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(source: TrustedSource, field: 'planningEnabled' | 'qaEnabled' | 'citationRequired' | 'isActive') {
    setSavingId(source.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/knowledge-sources', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: source.id,
          [field]: !source[field],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Failed to update trusted source.');
      setMessage('Source trust settings updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trusted source.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Source Trust</div>
      <h2 className="mt-1 text-lg font-semibold">Approved external coaching sources</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        These are the only external sources CoachKit can cite for coaching guidance in Tranche 8. Planning influence remains explicitly gated.
      </p>

      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {loading ? <div className="mt-3 text-sm text-[var(--muted)]">Loading trusted sources…</div> : null}

      {!loading ? (
        <div className="mt-4 space-y-3">
          {sources.map((source) => (
            <div key={source.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{source.title}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {source.authority} · {source.category} · trust tier {source.trustTier}
                  </div>
                  {source.summaryText ? <div className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{source.summaryText}</div> : null}
                  <a href={source.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">
                    Open source
                  </a>
                </div>
                <div className="grid min-w-[260px] gap-2 text-xs">
                  <ToggleButton
                    label="Q&A enabled"
                    value={source.qaEnabled}
                    disabled={savingId === source.id}
                    onClick={() => toggle(source, 'qaEnabled')}
                  />
                  <ToggleButton
                    label="Planning enabled"
                    value={source.planningEnabled}
                    disabled={savingId === source.id}
                    onClick={() => toggle(source, 'planningEnabled')}
                  />
                  <ToggleButton
                    label="Citation required"
                    value={source.citationRequired}
                    disabled={savingId === source.id}
                    onClick={() => toggle(source, 'citationRequired')}
                  />
                  <ToggleButton
                    label="Active"
                    value={source.isActive}
                    disabled={savingId === source.id}
                    onClick={() => toggle(source, 'isActive')}
                  />
                </div>
              </div>
              {source.tags.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {source.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ToggleButton(params: { label: string; value: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={params.disabled}
      onClick={params.onClick}
      className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left disabled:opacity-60"
    >
      <span>{params.label}</span>
      <span className={`rounded-full px-2 py-0.5 ${params.value ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
        {params.value ? 'On' : 'Off'}
      </span>
    </button>
  );
}

