'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { ApiClientError, useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type SourceTag = 'runtime' | 'env' | 'default';

type CapabilityRow = {
  capability: string;
  mode: { value: string; source: SourceTag };
  model: { value: string | null; source: SourceTag };
  maxOutputTokens: { value: number; source: SourceTag };
  rateLimitPerHour: { value: number; source: SourceTag };
};

type EngineControlsView = {
  runtimeOverrides: {
    aiMode?: 'deterministic' | 'llm';
    llmProvider?: 'openai' | 'mock';
    llmModel?: string;
    llmTimeoutMs?: number;
    llmMaxOutputTokens?: number;
    llmRetryCount?: number;
    llmRateLimitPerHour?: number;
    capabilities?: Record<
      string,
      {
        mode?: 'inherit' | 'deterministic' | 'llm';
        model?: string;
        maxOutputTokens?: number;
        rateLimitPerHour?: number;
      }
    >;
  };
  global: {
    aiMode: { value: string; source: SourceTag };
    llmProvider: { value: string; source: SourceTag };
    llmModel: { value: string | null; source: SourceTag };
    llmTimeoutMs: { value: number; source: SourceTag };
    llmMaxOutputTokens: { value: number; source: SourceTag };
    llmRetryCount: { value: number; source: SourceTag };
    llmRateLimitPerHour: { value: number; source: SourceTag };
  };
  capabilities: CapabilityRow[];
};

type EditableCapability = {
  mode: '' | 'inherit' | 'deterministic' | 'llm';
  model: string;
  maxOutputTokens: string;
  rateLimitPerHour: string;
};

type EditableOverrides = {
  aiMode: '' | 'deterministic' | 'llm';
  llmProvider: '' | 'openai' | 'mock';
  llmModel: string;
  llmTimeoutMs: string;
  llmMaxOutputTokens: string;
  llmRetryCount: string;
  llmRateLimitPerHour: string;
  capabilities: Record<string, EditableCapability>;
};

function sourceClass(source: SourceTag): string {
  if (source === 'runtime') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  if (source === 'env') return 'bg-sky-100 text-sky-800 border-sky-300';
  return 'bg-slate-100 text-slate-700 border-slate-300';
}

function toEditable(view: EngineControlsView): EditableOverrides {
  const caps: Record<string, EditableCapability> = {};
  for (const row of view.capabilities) {
    const runtime = view.runtimeOverrides.capabilities?.[row.capability] ?? {};
    caps[row.capability] = {
      mode: (runtime.mode as EditableCapability['mode']) ?? '',
      model: String(runtime.model ?? ''),
      maxOutputTokens: runtime.maxOutputTokens != null ? String(runtime.maxOutputTokens) : '',
      rateLimitPerHour: runtime.rateLimitPerHour != null ? String(runtime.rateLimitPerHour) : '',
    };
  }

  return {
    aiMode: (view.runtimeOverrides.aiMode as EditableOverrides['aiMode']) ?? '',
    llmProvider: (view.runtimeOverrides.llmProvider as EditableOverrides['llmProvider']) ?? '',
    llmModel: String(view.runtimeOverrides.llmModel ?? ''),
    llmTimeoutMs: view.runtimeOverrides.llmTimeoutMs != null ? String(view.runtimeOverrides.llmTimeoutMs) : '',
    llmMaxOutputTokens: view.runtimeOverrides.llmMaxOutputTokens != null ? String(view.runtimeOverrides.llmMaxOutputTokens) : '',
    llmRetryCount: view.runtimeOverrides.llmRetryCount != null ? String(view.runtimeOverrides.llmRetryCount) : '',
    llmRateLimitPerHour: view.runtimeOverrides.llmRateLimitPerHour != null ? String(view.runtimeOverrides.llmRateLimitPerHour) : '',
    capabilities: caps,
  };
}

function toNumber(value: string): number | undefined {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : undefined;
}

function buildPayload(edits: EditableOverrides) {
  const capabilities: Record<string, unknown> = {};
  for (const [capability, row] of Object.entries(edits.capabilities)) {
    const out: Record<string, unknown> = {};
    if (row.mode) out.mode = row.mode;
    if (row.model.trim()) out.model = row.model.trim();
    const maxOutputTokens = toNumber(row.maxOutputTokens);
    if (maxOutputTokens != null) out.maxOutputTokens = Math.round(maxOutputTokens);
    const rateLimitPerHour = toNumber(row.rateLimitPerHour);
    if (rateLimitPerHour != null) out.rateLimitPerHour = Math.round(rateLimitPerHour);
    if (Object.keys(out).length > 0) capabilities[capability] = out;
  }

  const payload: Record<string, unknown> = {};
  if (edits.aiMode) payload.aiMode = edits.aiMode;
  if (edits.llmProvider) payload.llmProvider = edits.llmProvider;
  if (edits.llmModel.trim()) payload.llmModel = edits.llmModel.trim();
  const llmTimeoutMs = toNumber(edits.llmTimeoutMs);
  if (llmTimeoutMs != null) payload.llmTimeoutMs = Math.round(llmTimeoutMs);
  const llmMaxOutputTokens = toNumber(edits.llmMaxOutputTokens);
  if (llmMaxOutputTokens != null) payload.llmMaxOutputTokens = Math.round(llmMaxOutputTokens);
  const llmRetryCount = toNumber(edits.llmRetryCount);
  if (llmRetryCount != null) payload.llmRetryCount = Math.round(llmRetryCount);
  const llmRateLimitPerHour = toNumber(edits.llmRateLimitPerHour);
  if (llmRateLimitPerHour != null) payload.llmRateLimitPerHour = Math.round(llmRateLimitPerHour);
  if (Object.keys(capabilities).length > 0) payload.capabilities = capabilities;

  return { overrides: payload };
}

export function AdminAiEngineControlsPage() {
  const { request } = useApi();
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [view, setView] = useState<EngineControlsView | null>(null);
  const [edits, setEdits] = useState<EditableOverrides | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const data = await request<EngineControlsView>('/api/admin/ai-plan-builder/engine-controls', { cache: 'no-store' });
      setView(data);
      setEdits(toEditable(data));
    } catch (e) {
      const message = e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Failed to load engine controls.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!edits) return;
    setBusy('save');
    setError(null);
    setInfo(null);
    try {
      const data = await request<EngineControlsView>('/api/admin/ai-plan-builder/engine-controls', {
        method: 'PUT',
        data: buildPayload(edits),
      });
      setView(data);
      setEdits(toEditable(data));
      setInfo('Engine controls saved. Runtime overrides are now active.');
    } catch (e) {
      const message = e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Failed to save engine controls.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [edits, request]);

  const clearOverrides = useCallback(async () => {
    setBusy('save');
    setError(null);
    setInfo(null);
    try {
      const data = await request<EngineControlsView>('/api/admin/ai-plan-builder/engine-controls', {
        method: 'PUT',
        data: { overrides: {} },
      });
      setView(data);
      setEdits(toEditable(data));
      setInfo('Runtime overrides cleared. Env/default values are active.');
    } catch (e) {
      const message = e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Failed to clear overrides.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [request]);

  const effectiveRows = useMemo(() => {
    if (!view) return null;
    return (
      <>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Global effective settings</div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {[
              { label: 'AI mode', value: view.global.aiMode.value, source: view.global.aiMode.source },
              { label: 'LLM provider', value: view.global.llmProvider.value, source: view.global.llmProvider.source },
              { label: 'LLM model', value: view.global.llmModel.value ?? '—', source: view.global.llmModel.source },
              { label: 'Timeout (ms)', value: String(view.global.llmTimeoutMs.value), source: view.global.llmTimeoutMs.source },
              {
                label: 'Max output tokens',
                value: String(view.global.llmMaxOutputTokens.value),
                source: view.global.llmMaxOutputTokens.source,
              },
              { label: 'Retry count', value: String(view.global.llmRetryCount.value), source: view.global.llmRetryCount.source },
              {
                label: 'Rate limit / hour',
                value: String(view.global.llmRateLimitPerHour.value),
                source: view.global.llmRateLimitPerHour.source,
              },
            ].map((row) => (
              <div key={row.label} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-xs text-[var(--fg-muted)]">{row.label}</div>
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${sourceClass(row.source)}`}>{row.source}</span>
                </div>
                <div className="text-sm font-medium">{row.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Capability effective settings</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                  <th className="px-2 py-2">Capability</th>
                  <th className="px-2 py-2">Mode</th>
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2">Max Tokens</th>
                  <th className="px-2 py-2">Rate Limit/hr</th>
                </tr>
              </thead>
              <tbody>
                {view.capabilities.map((row) => (
                  <tr key={row.capability} className="border-b border-[var(--border-subtle)]">
                    <td className="px-2 py-2 font-medium">{row.capability}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span>{row.mode.value}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(row.mode.source)}`}>{row.mode.source}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span>{row.model.value ?? '—'}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(row.model.source)}`}>{row.model.source}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span>{row.maxOutputTokens.value}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(row.maxOutputTokens.source)}`}>{row.maxOutputTokens.source}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span>{row.rateLimitPerHour.value}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(row.rateLimitPerHour.source)}`}>{row.rateLimitPerHour.source}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }, [view]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Engine Controls</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            View all active APB levers and apply runtime overrides without redeploys.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/ai-plan-builder/policy-tuning" className="rounded border border-[var(--border-subtle)] px-3 py-2 text-sm">
            Open policy tuning
          </Link>
          <Button variant="secondary" onClick={() => void load()} disabled={busy != null}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {info ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</div> : null}

      {effectiveRows}

      {edits ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Runtime override editor</div>
          <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">AI mode</label>
              <select
                className="h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-sm"
                value={edits.aiMode}
                onChange={(e) => setEdits((prev) => (prev ? { ...prev, aiMode: e.target.value as EditableOverrides['aiMode'] } : prev))}
              >
                <option value="">(inherit env/default)</option>
                <option value="deterministic">deterministic</option>
                <option value="llm">llm</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">LLM provider</label>
              <select
                className="h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-sm"
                value={edits.llmProvider}
                onChange={(e) =>
                  setEdits((prev) => (prev ? { ...prev, llmProvider: e.target.value as EditableOverrides['llmProvider'] } : prev))
                }
              >
                <option value="">(inherit env/default)</option>
                <option value="openai">openai</option>
                <option value="mock">mock</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">LLM model</label>
              <Input
                value={edits.llmModel}
                onChange={(e) => setEdits((prev) => (prev ? { ...prev, llmModel: e.target.value } : prev))}
                placeholder="e.g. gpt-5.2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Timeout (ms)</label>
              <Input
                value={edits.llmTimeoutMs}
                onChange={(e) => setEdits((prev) => (prev ? { ...prev, llmTimeoutMs: e.target.value } : prev))}
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Max output tokens</label>
              <Input
                value={edits.llmMaxOutputTokens}
                onChange={(e) => setEdits((prev) => (prev ? { ...prev, llmMaxOutputTokens: e.target.value } : prev))}
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Retry count</label>
              <Input
                value={edits.llmRetryCount}
                onChange={(e) => setEdits((prev) => (prev ? { ...prev, llmRetryCount: e.target.value } : prev))}
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Rate limit / hour</label>
              <Input
                value={edits.llmRateLimitPerHour}
                onChange={(e) => setEdits((prev) => (prev ? { ...prev, llmRateLimitPerHour: e.target.value } : prev))}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">Per-capability overrides</div>
          <div className="space-y-2">
            {Object.entries(edits.capabilities).map(([capability, row]) => (
              <div key={capability} className="grid gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 md:grid-cols-[minmax(0,1.4fr)_1fr_1.2fr_1fr_1fr]">
                <div className="flex items-center text-sm font-medium">{capability}</div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--fg-muted)]">Mode</label>
                  <select
                    className="h-9 w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 text-sm"
                    value={row.mode}
                    onChange={(e) =>
                      setEdits((prev) =>
                        prev
                          ? {
                              ...prev,
                              capabilities: {
                                ...prev.capabilities,
                                [capability]: { ...prev.capabilities[capability], mode: e.target.value as EditableCapability['mode'] },
                              },
                            }
                          : prev
                      )
                    }
                  >
                    <option value="">(inherit)</option>
                    <option value="inherit">inherit</option>
                    <option value="deterministic">deterministic</option>
                    <option value="llm">llm</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--fg-muted)]">Model</label>
                  <Input
                    value={row.model}
                    onChange={(e) =>
                      setEdits((prev) =>
                        prev
                          ? {
                              ...prev,
                              capabilities: {
                                ...prev.capabilities,
                                [capability]: { ...prev.capabilities[capability], model: e.target.value },
                              },
                            }
                          : prev
                      )
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--fg-muted)]">Max tokens</label>
                  <Input
                    value={row.maxOutputTokens}
                    onChange={(e) =>
                      setEdits((prev) =>
                        prev
                          ? {
                              ...prev,
                              capabilities: {
                                ...prev.capabilities,
                                [capability]: { ...prev.capabilities[capability], maxOutputTokens: e.target.value },
                              },
                            }
                          : prev
                      )
                    }
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--fg-muted)]">Rate limit/hr</label>
                  <Input
                    value={row.rateLimitPerHour}
                    onChange={(e) =>
                      setEdits((prev) =>
                        prev
                          ? {
                              ...prev,
                              capabilities: {
                                ...prev.capabilities,
                                [capability]: { ...prev.capabilities[capability], rateLimitPerHour: e.target.value },
                              },
                            }
                          : prev
                      )
                    }
                    inputMode="numeric"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => void clearOverrides()} disabled={busy != null}>
              Clear runtime overrides
            </Button>
            <Button onClick={() => void save()} disabled={busy != null}>
              Save runtime overrides
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
