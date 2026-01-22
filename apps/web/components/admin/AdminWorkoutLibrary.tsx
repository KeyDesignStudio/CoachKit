'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ApiClientError, useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { AdminPlanLibraryImporter } from '@/components/admin/AdminPlanLibraryImporter';
import { AdminPlanLibraryPurge } from '@/components/admin/AdminPlanLibraryPurge';
import { CANONICAL_EQUIPMENT, type CanonicalEquipment } from '@/lib/workout-library-taxonomy';

type Discipline = 'RUN' | 'BIKE' | 'SWIM' | 'BRICK' | 'STRENGTH' | 'OTHER';

type LibraryItem = {
  id: string;
  title: string;
  discipline: Discipline;
  status?: 'DRAFT' | 'PUBLISHED';
  source?: 'MANUAL';
  category?: string | null;
  tags: string[];
  description: string;
  notes: string | null;
  equipment: string[];
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  usageCount?: number;
};

type MaintenanceAction = 'normalizeTags' | 'normalizeEquipment' | 'recomputeIntensityCategory';

type MaintenanceSummary = {
  dryRun: boolean;
  action: MaintenanceAction;
  scanned: number;
  updated: number;
  unchanged: number;
  errors: number;
  examples: Array<{ id: string; title: string; before: unknown; after: unknown }>;
};

type ImportResult = {
  dryRun: boolean;
  totalCount: number;
  validCount: number;
  errorCount: number;
  preview: unknown[];
  errors: Array<{ index: number; message: string }>;
  createdCount: number;
  createdIds: string[];
  skippedExistingCount?: number;
  message?: string;
};

const DISCIPLINES: Discipline[] = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'OTHER'];

function splitCommaList(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function parseCsv(text: string): { items: Record<string, unknown>[]; errors: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return { items: [], errors: ['CSV is empty.'] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const errors: string[] = [];

  if (header.length === 0 || header.every((h) => !h)) {
    return { items: [], errors: ['CSV header row is missing.'] };
  }

  const items: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = {};

    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      row[key] = (values[c] ?? '').trim();
    }

    items.push(row);
  }

  // Basic header sanity check to avoid confusing failures.
  // Prompt Library import columns (minimal): title, discipline, category, workoutDetail.
  const required = ['title', 'discipline', 'category', 'workoutDetail'];
  const missing = required.filter((k) => !header.includes(k));
  if (missing.length > 0) {
    errors.push(`Missing required columns: ${missing.join(', ')}`);
  }

  return { items, errors };
}

export function AdminWorkoutLibrary() {
  const { request } = useApi();
  const searchParams = useSearchParams();

  const showDbBanner =
    process.env.NODE_ENV !== 'production' || (searchParams?.get('debugDb') ?? '') === '1';

  const [dbHealth, setDbHealth] = useState<
    | { ok: true; host: string; timestamp: string }
    | { ok: false; error: string; host: string; requestId: string }
    | null
  >(null);
  const [dbHealthLoading, setDbHealthLoading] = useState(false);
  const [dbHealthFetchError, setDbHealthFetchError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [discipline, setDiscipline] = useState<string>('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState<string>('');

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [formDiscipline, setFormDiscipline] = useState<Discipline>('RUN');
  const [category, setCategory] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [description, setDescription] = useState('');
  const [equipment, setEquipment] = useState<CanonicalEquipment[]>([]);
  const [notes, setNotes] = useState('');

  const [activeRightTab, setActiveRightTab] = useState<'edit' | 'import' | 'maintenance'>('edit');

  useEffect(() => {
    if (!showDbBanner) return;
    if (activeRightTab !== 'import') return;

    let cancelled = false;
    setDbHealthLoading(true);
    setDbHealthFetchError(null);

    void (async () => {
      try {
        const response = await fetch('/api/health/db', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
        });

        const payload = (await response.json()) as any;
        if (cancelled) return;
        setDbHealth(payload);
      } catch (err) {
        if (cancelled) return;
        setDbHealth(null);
        setDbHealthFetchError(err instanceof Error ? err.message : 'Failed to fetch /api/health/db');
      } finally {
        if (!cancelled) setDbHealthLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRightTab, showDbBanner]);

  const [importDryRun, setImportDryRun] = useState(true);
  const [importConfirmApply, setImportConfirmApply] = useState(false);
  const [importItems, setImportItems] = useState<unknown[]>([]);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [isDryRunBusy, setIsDryRunBusy] = useState(false);
  const [isApplyBusy, setIsApplyBusy] = useState(false);

  const [maintenanceDryRun, setMaintenanceDryRun] = useState(true);
  const [maintenancePurgeConfirm, setMaintenancePurgeConfirm] = useState('');
  const [maintenancePublishConfirm, setMaintenancePublishConfirm] = useState('');
  const [maintenanceRunning, setMaintenanceRunning] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceSummary | null>(null);

  const [testArtifactsConfirmText, setTestArtifactsConfirmText] = useState('');
  const [testArtifactsRunning, setTestArtifactsRunning] = useState(false);
  const [testArtifactsError, setTestArtifactsError] = useState<string | null>(null);
  const [testArtifactsResult, setTestArtifactsResult] = useState<
    | null
    | {
        dryRun: boolean;
        matchedCount: number;
        deletedCount: number;
        sampleIds: string[];
        sampleTitles: string[];
      }
  >(null);

  const [publishRunning, setPublishRunning] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishOk, setPublishOk] = useState<string | null>(null);
  const [publishSelectedConfirm, setPublishSelectedConfirm] = useState(false);
  const [publishImportConfirmText, setPublishImportConfirmText] = useState('');

  const [unpublishRunning, setUnpublishRunning] = useState(false);
  const [unpublishError, setUnpublishError] = useState<string | null>(null);
  const [unpublishOk, setUnpublishOk] = useState<string | null>(null);

  const runPurgeTestArtifacts = useCallback(
    async (confirmApply: boolean) => {
      setTestArtifactsRunning(true);
      setTestArtifactsError(null);
      setTestArtifactsResult(null);

      try {
        const data = await request<{
          dryRun: boolean;
          matchedCount: number;
          deletedCount: number;
          sampleIds: string[];
          sampleTitles: string[];
        }>('/api/admin/workout-library/purge-test-artifacts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmApply }),
        });

        setTestArtifactsResult(data);
      } catch (e) {
        if (e instanceof ApiClientError) {
          setTestArtifactsError(`${e.code}: ${e.message}`);
        } else {
          setTestArtifactsError(e instanceof Error ? e.message : 'Cleanup failed');
        }
      } finally {
        setTestArtifactsRunning(false);
      }
    },
    [request]
  );
  const [maintenanceUnpublishConfirm, setMaintenanceUnpublishConfirm] = useState('');

  const selected = useMemo(
    () => (selectedId ? items.find((it) => it.id === selectedId) ?? null : null),
    [items, selectedId]
  );

  const fetchList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);

    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (discipline.trim()) params.set('discipline', discipline.trim());
      if (tag.trim()) params.set('tag', tag.trim());
      if (status.trim()) params.set('status', status.trim());

      const data = await request<{ items: LibraryItem[] }>(
        `/api/admin/workout-library${params.size ? `?${params.toString()}` : ''}`,
        { cache: 'no-store' }
      );
      setItems(data.items);

      // Keep selection stable if possible.
      if (selectedId && !data.items.some((it) => it.id === selectedId)) {
        setSelectedId(null);
        setMode('create');
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Failed to load.');
    } finally {
      setLoadingList(false);
    }
  }, [discipline, q, request, selectedId, status, tag]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const resetForm = useCallback(() => {
    setTitle('');
    setFormDiscipline('RUN');
    setCategory('');
    setTagsText('');
    setDescription('');
    setEquipment([]);
    setNotes('');
    setSaveError(null);
    setSaveOk(null);
  }, []);

  useEffect(() => {
    if (importDryRun) setImportConfirmApply(false);
  }, [importDryRun]);

  const startCreate = useCallback(() => {
    setSelectedId(null);
    setMode('create');
    setActiveRightTab('edit');
    resetForm();
  }, [resetForm]);

  const startEdit = useCallback(
    (item: LibraryItem) => {
      setSelectedId(item.id);
      setMode('edit');
      setActiveRightTab('edit');

      setTitle(item.title ?? '');
      setFormDiscipline(item.discipline);
      setCategory(item.category ?? '');
      setTagsText((item.tags ?? []).join(', '));
      setDescription(item.description ?? '');
      setEquipment(() => {
        const raw = item.equipment ?? [];
        const canonical = raw.filter((e): e is CanonicalEquipment =>
          (CANONICAL_EQUIPMENT as readonly string[]).includes(e)
        ) as CanonicalEquipment[];
        const hasUnknown = raw.some((e) => !(CANONICAL_EQUIPMENT as readonly string[]).includes(e));
        if (hasUnknown && !canonical.includes('Other')) return [...canonical, 'Other'];
        return canonical;
      });
      setNotes(item.notes ?? '');

      setSaveError(null);
      setSaveOk(null);

      setPublishError(null);
      setPublishOk(null);
      setPublishSelectedConfirm(false);
    },
    []
  );

  const publishDrafts = useCallback(
    async (payload: { ids?: string[] }) => {
      setPublishRunning(true);
      setPublishError(null);
      setPublishOk(null);
      try {
        const result = await request<{
          matchedCount: number;
          publishedCount: number;
          alreadyPublishedCount: number;
          errors: string[];
        }>('/api/admin/workout-library/publish', {
          method: 'POST',
          data: {
            ...payload,
            confirmApply: true,
          },
        });

        setPublishOk(
          `Published ${result.publishedCount} draft workout(s) (matched ${result.matchedCount}, already published ${result.alreadyPublishedCount}).`
        );
        await fetchList();
      } catch (error) {
        if (error instanceof ApiClientError) {
          setPublishError(`${error.code}: ${error.message}${error.requestId ? ` (requestId: ${error.requestId})` : ''}`);
        } else {
          setPublishError(error instanceof Error ? error.message : 'Publish failed.');
        }
      } finally {
        setPublishRunning(false);
      }
    },
    [fetchList, request]
  );

  const unpublishWorkouts = useCallback(
    async (payload: { ids?: string[] }) => {
      setUnpublishRunning(true);
      setUnpublishError(null);
      setUnpublishOk(null);
      try {
        const result = await request<{
          matchedCount: number;
          unpublishedCount: number;
          alreadyDraftCount: number;
          errors: string[];
        }>('/api/admin/workout-library/unpublish', {
          method: 'POST',
          data: {
            ...payload,
            confirmApply: true,
          },
        });

        setUnpublishOk(
          `Unpublished ${result.unpublishedCount} workout(s) (matched ${result.matchedCount}, already draft ${result.alreadyDraftCount}).`
        );
        await fetchList();
      } catch (error) {
        if (error instanceof ApiClientError) {
          setUnpublishError(
            `${error.code}: ${error.message}${error.requestId ? ` (requestId: ${error.requestId})` : ''}`
          );
        } else {
          setUnpublishError(error instanceof Error ? error.message : 'Unpublish failed.');
        }
      } finally {
        setUnpublishRunning(false);
      }
    },
    [fetchList, request]
  );

  useEffect(() => {
    if (selected && mode === 'edit') {
      startEdit(selected);
    }
  }, [mode, selected, startEdit]);

  const onSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);

    try {
      const tags = splitCommaList(tagsText);
      const equipmentPayload = equipment;

      const payload = {
        title: title.trim(),
        discipline: formDiscipline,
        tags,
        category: category.trim(),
        description: description.trim(),
        notes: notes.trim() ? notes.trim() : null,
        equipment: equipmentPayload,
      };

      if (mode === 'create') {
        const data = await request<{ item: LibraryItem }>(`/api/admin/workout-library`, {
          method: 'POST',
          data: payload,
        });
        setSaveOk('Created.');
        await fetchList();
        setSelectedId(data.item.id);
        setMode('edit');
      } else {
        if (!selectedId) throw new Error('No item selected.');
        await request<{ item: LibraryItem }>(`/api/admin/workout-library/${selectedId}`, {
          method: 'PATCH',
          data: payload,
        });
        setSaveOk('Saved.');
        await fetchList();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [
    category,
    description,
    equipment,
    fetchList,
    formDiscipline,
    mode,
    notes,
    request,
    selectedId,
    tagsText,
    title,
  ]);

  const runMaintenance = useCallback(
    async (
      action: MaintenanceAction | 'purgeDraftImportsBySource',
      dryRun: boolean,
      extra?: { source?: string; confirm?: string }
    ) => {
      setMaintenanceRunning(true);
      setMaintenanceError(null);
      setMaintenanceResult(null);
      try {
        const data = await request<MaintenanceSummary>(`/api/admin/workout-library/maintenance`, {
          method: 'POST',
          data: { action, dryRun, ...extra },
        });
        setMaintenanceResult(data);
        // Refresh list after apply.
        if (!dryRun) {
          await fetchList();
        }
      } catch (error) {
        setMaintenanceError(error instanceof Error ? error.message : 'Maintenance failed.');
      } finally {
        setMaintenanceRunning(false);
      }
    },
    [fetchList, request]
  );

  const onDelete = useCallback(
    async (id: string) => {
      const ok = window.confirm('Delete this library session? This cannot be undone.');
      if (!ok) return;

      try {
        await request<{ ok: true }>(`/api/admin/workout-library/${id}`, {
          method: 'DELETE',
        });
        if (selectedId === id) {
          startCreate();
        }
        await fetchList();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Delete failed.');
      }
    },
    [fetchList, request, selectedId, startCreate]
  );

  const onImportCall = useCallback(
    async (dryRun: boolean) => {
      setImporting(true);
      setImportResult(null);
      try {
        const data = await request<ImportResult>(`/api/admin/workout-library/import`, {
          method: 'POST',
          data: {
            dryRun,
            confirmApply: !dryRun && importConfirmApply,
            items: importItems,
          },
        });
        setImportResult(data);
        if (!dryRun && data.createdCount > 0) {
          await fetchList();
        }
      } catch (error) {
        setImportResult(null);
        setImportParseError(error instanceof Error ? error.message : 'Import failed.');
      } finally {
        setImporting(false);
      }
    },
    [fetchList, importConfirmApply, importItems, request]
  );

  const onFileSelected = useCallback(async (file: File) => {
    setImportParseError(null);
    setImportResult(null);
    setImportItems([]);

    const raw = await file.text();

    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : parsed?.items;
        if (!Array.isArray(items)) {
          throw new Error('JSON must be an array or an object with { items: [...] }.');
        }
        setImportItems(items);
      } catch (error) {
        setImportParseError(error instanceof Error ? error.message : 'Invalid JSON file.');
      }
      return;
    }

    if (file.name.toLowerCase().endsWith('.csv')) {
      const parsed = parseCsv(raw);
      if (parsed.errors.length > 0) {
        setImportParseError(parsed.errors.join(' | '));
      }
      setImportItems(parsed.items);
      return;
    }

    setImportParseError('Unsupported file type. Use .csv or .json');
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[var(--text)]">Library Sessions</div>
            <Button variant="secondary" size="sm" onClick={startCreate}>
              New
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Input
              data-testid="admin-workout-library-search"
              placeholder="Search title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchList();
              }}
            />
            <Select value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
              <option value="">All disciplines</option>
              {DISCIPLINES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PUBLISHED">PUBLISHED</option>
            </Select>
            <Input
              placeholder="Tag contains…"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchList();
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void fetchList()} disabled={loadingList}>
              {loadingList ? 'Loading…' : 'Refresh'}
            </Button>
            <div className="text-xs text-[var(--muted)]">Showing {items.length} (max 200)</div>
            <div className="text-xs text-[var(--muted)]">Coaches only see PUBLISHED prompts.</div>
          </div>

          {listError ? <div className="text-sm text-red-600">{listError}</div> : null}

          <div className="max-h-[70vh] overflow-auto rounded-2xl border border-[var(--border-subtle)]">
            <div className="divide-y divide-[var(--border-subtle)]">
              {items.map((it) => {
                const isSelected = it.id === selectedId;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => startEdit(it)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-[var(--bg-structure)] ${
                      isSelected ? 'bg-[var(--bg-structure)]' : 'bg-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text)]">{it.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                          <span>{it.discipline}</span>
                          {it.status ? (
                            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                              {it.status}
                            </span>
                          ) : null}
                          {it.source ? (
                            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                              {it.source}
                            </span>
                          ) : null}
                          <span>Usage: {it.usageCount ?? 0}</span>
                          {it.category ? <span>Category: {it.category}</span> : null}
                        </div>
                        {it.tags?.length ? (
                          <div className="mt-1 truncate text-xs text-[var(--muted)]">
                            Tags: {it.tags.join(', ')}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void onDelete(it.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </button>
                );
              })}

              {items.length === 0 && !listError ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">No sessions found.</div>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 md:p-6">
        <div className="flex items-center gap-2">
          <Button
            variant={activeRightTab === 'edit' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveRightTab('edit')}
          >
            {mode === 'create' ? 'Create' : 'Edit'}
          </Button>
          <Button
            data-testid="admin-workout-library-import"
            variant={activeRightTab === 'import' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveRightTab('import')}
          >
            Import
          </Button>
          <Button
            variant={activeRightTab === 'maintenance' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveRightTab('maintenance')}
          >
            Maintenance
          </Button>
        </div>

        {activeRightTab === 'edit' ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Select value={formDiscipline} onChange={(e) => setFormDiscipline(e.target.value as Discipline)}>
                {DISCIPLINES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>

            <Input
              placeholder="Category (e.g. Endurance / Tempo / Skills)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />

            <Input
              placeholder="Tags (comma-separated)"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />

            <Textarea
              placeholder="Workout detail (prompt)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />

            <div className="rounded-2xl border border-[var(--border-subtle)] p-3">
              <div className="text-xs font-semibold text-[var(--text)]">Equipment</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {CANONICAL_EQUIPMENT.map((value) => {
                  const active = equipment.includes(value);
                  return (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={active ? 'primary' : 'secondary'}
                      onClick={() =>
                        setEquipment((prev) =>
                          prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]
                        )
                      }
                    >
                      {value}
                    </Button>
                  );
                })}

                {equipment.length > 0 ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEquipment([])}>
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 text-xs text-[var(--muted)]">
                Admin save will normalize equipment to this canonical list (unknown values map to “Other”).
              </div>
            </div>

            <Textarea
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />

            {saveError ? <div className="text-sm text-red-600">{saveError}</div> : null}
            {saveOk ? <div className="text-sm text-green-700">{saveOk}</div> : null}

            {publishError ? <div className="text-sm text-red-600">{publishError}</div> : null}
            {publishOk ? <div className="text-sm text-green-700">{publishOk}</div> : null}
            {unpublishError ? <div className="text-sm text-red-600">{unpublishError}</div> : null}
            {unpublishOk ? <div className="text-sm text-green-700">{unpublishOk}</div> : null}

            <div className="flex items-center gap-2">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
              </Button>

              {mode === 'edit' && selected?.status ? (
                <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                  {selected.status}
                </span>
              ) : null}

              {mode === 'edit' && selected?.status === 'DRAFT' ? (
                <label className="ml-2 flex items-center gap-2 text-xs text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={publishSelectedConfirm}
                    onChange={(e) => setPublishSelectedConfirm(e.target.checked)}
                    disabled={publishRunning || unpublishRunning}
                  />
                  Confirm publish
                </label>
              ) : null}

              {mode === 'edit' && selected?.status === 'DRAFT' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={publishRunning || unpublishRunning || !publishSelectedConfirm}
                  onClick={() => void publishDrafts({ ids: [selected.id] })}
                >
                  {publishRunning ? 'Publishing…' : 'Publish'}
                </Button>
              ) : null}

              {mode === 'edit' && selected?.status === 'PUBLISHED' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={publishRunning || unpublishRunning}
                  onClick={() => void unpublishWorkouts({ ids: [selected.id] })}
                >
                  {unpublishRunning ? 'Unpublishing…' : 'Unpublish'}
                </Button>
              ) : null}

              {mode === 'edit' && selected ? (
                <div className="text-xs text-[var(--muted)]">
                  Usage: {selected.usageCount ?? 0} • Updated {new Date(selected.updatedAt).toLocaleString()}
                </div>
              ) : (
                <div className="text-xs text-[var(--muted)]">Create a new session or select one.</div>
              )}
            </div>
          </div>
        ) : (
          activeRightTab === 'import' ? (
            <div className="mt-4 flex flex-col gap-3">
            <div className="text-sm font-semibold text-[var(--text)]">Import</div>
            <div className="text-xs text-[var(--muted)]">
              Safety: dry-run by default. Apply requires confirmation. Imports create DRAFT prompts (not visible to coaches until published).
            </div>

            <AdminPlanLibraryImporter />

            <AdminPlanLibraryPurge />

            {showDbBanner ? (
              <div className="rounded border border-[var(--border)] bg-white p-3 text-xs text-[var(--text)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">DB Host</div>
                    <div className="text-[var(--muted)]">
                      {dbHealthLoading
                        ? 'Checking…'
                        : dbHealthFetchError
                          ? `Health check fetch failed: ${dbHealthFetchError}`
                          : dbHealth
                            ? dbHealth.host
                            : 'unknown'}
                    </div>
                  </div>

                  <div className="text-right text-[var(--muted)]">
                    {dbHealthLoading ? null : dbHealth ? (
                      dbHealth.ok ? (
                        <div>status: ok</div>
                      ) : (
                        <div>status: unreachable (requestId: {dbHealth.requestId})</div>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {(() => {
              const hasRows = importItems.length > 0;
              const busy = isDryRunBusy || isApplyBusy;

              const canDryRun = !busy && hasRows;
              const canApply = !busy && importConfirmApply && hasRows;

              const debugEnabled =
                process.env.NODE_ENV !== 'production' &&
                typeof window !== 'undefined' &&
                new URLSearchParams(window.location.search).has('debugImport');

              const runDryRun = async () => {
                if (!canDryRun) return;

                setIsDryRunBusy(true);
                try {
                  await onImportCall(true);
                } finally {
                  setIsDryRunBusy(false);
                }
              };

              const runApply = async () => {
                if (!canApply) return;

                setIsApplyBusy(true);
                try {
                  await onImportCall(false);
                } finally {
                  setIsApplyBusy(false);
                }
              };

              return (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                          <input
                            data-testid="admin-import-dryrun-toggle"
                            type="checkbox"
                            checked={importDryRun}
                            onChange={(e) => setImportDryRun(e.target.checked)}
                          />
                          Dry run
                        </label>

                        {!importDryRun ? (
                          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                            <input
                              type="checkbox"
                              checked={importConfirmApply}
                              onChange={(e) => setImportConfirmApply(e.target.checked)}
                            />
                            Confirm apply
                          </label>
                        ) : null}
                    </div>

                    {!importDryRun ? (
                      <div className="text-xs text-amber-700">This will create prompts in the library.</div>
                    ) : null}

                    <div className="text-xs text-[var(--muted)]">
                      Reminder: coaches only see PUBLISHED prompts. Use the Publish controls after importing.
                    </div>

                    <input
                      data-testid="admin-import-file"
                      type="file"
                      accept=".csv,.json,application/json,text/csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void onFileSelected(file);
                      }}
                    />

                    <div className="text-xs text-[var(--muted)]">Upload a CSV/JSON file once, then run a dry-run or import.</div>
                    <div className="text-xs text-[var(--muted)]">Loaded rows: {importItems.length}</div>
                  </div>

                  {importParseError ? <div className="text-sm text-red-600">{importParseError}</div> : null}

                  {debugEnabled ? (
                    <div
                      data-testid="admin-import-debug"
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-3 text-xs text-[var(--text)]"
                    >
                      busy={String(busy)} hasRows={String(hasRows)} confirmApply={String(importConfirmApply)}
                      dryRunChecked={String(importDryRun)} canDryRun={String(canDryRun)} canApply={String(canApply)}
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <Button
                      data-testid={importDryRun ? 'admin-import-run-dryrun' : 'admin-import-run-apply'}
                      variant={importDryRun ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={importDryRun ? !canDryRun : !canApply}
                      onClick={() => void (importDryRun ? runDryRun() : runApply())}
                    >
                      {importDryRun ? 'Run Dry-Run' : 'Import Now'}
                    </Button>
                  </div>
                </>
              );
            })()}

            {importResult ? (
              <div className="rounded-2xl border border-[var(--border-subtle)] p-4">
                <div className="text-sm font-medium text-[var(--text)]">
                  Result: {importResult.validCount}/{importResult.totalCount} valid • {importResult.errorCount} errors
                </div>
                {importResult.message ? (
                  <div className="mt-1 text-sm text-[var(--muted)]">{importResult.message}</div>
                ) : null}
                {importResult.createdCount > 0 ? (
                  <div className="mt-1 text-sm text-green-700">Created {importResult.createdCount} sessions.</div>
                ) : null}
                {typeof importResult.skippedExistingCount === 'number' && importResult.skippedExistingCount > 0 ? (
                  <div className="mt-1 text-sm text-[var(--muted)]">Skipped duplicates: {importResult.skippedExistingCount}</div>
                ) : null}

                {importResult.errors.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-semibold text-[var(--text)]">Row errors</div>
                    <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--border-subtle)]">
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {importResult.errors.slice(0, 50).map((e) => (
                          <div key={`${e.index}-${e.message}`} className="px-3 py-2 text-xs text-red-700">
                            Row {e.index}: {e.message}
                          </div>
                        ))}
                        {importResult.errors.length > 50 ? (
                          <div className="px-3 py-2 text-xs text-[var(--muted)]">
                            Showing first 50 errors…
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {importResult.preview.length ? (
                  <div className="mt-3">
                    <div className="text-sm font-semibold text-[var(--text)]">Preview (first 20 valid)</div>
                    <pre className="mt-2 max-h-56 overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-3 text-xs text-[var(--text)]">
                      {JSON.stringify(importResult.preview, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <div className="text-sm font-semibold text-[var(--text)]">Library Maintenance</div>
                <div className="text-xs text-[var(--muted)]">
                  Runs server-side normalization across existing library sessions. Start with a dry-run.
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={maintenanceDryRun}
                  onChange={(e) => setMaintenanceDryRun(e.target.checked)}
                />
                Dry run
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={maintenanceRunning}
                  onClick={() => void runMaintenance('normalizeTags', maintenanceDryRun)}
                >
                  Normalize all tags
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={maintenanceRunning}
                  onClick={() => void runMaintenance('normalizeEquipment', maintenanceDryRun)}
                >
                  Normalize all equipment
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={maintenanceRunning}
                  onClick={() => void runMaintenance('recomputeIntensityCategory', maintenanceDryRun)}
                >
                  Recompute intensityCategory
                </Button>
              </div>

              {maintenanceRunning ? (
                <div className="text-sm text-[var(--muted)]">Working…</div>
              ) : null}
              {maintenanceError ? <div className="text-sm text-red-600">{maintenanceError}</div> : null}

              {maintenanceResult ? (
                <div className="rounded-2xl border border-[var(--border-subtle)] p-4">
                  <div className="text-sm font-medium text-[var(--text)]">
                    Result: scanned {maintenanceResult.scanned} • updated {maintenanceResult.updated} • unchanged{' '}
                    {maintenanceResult.unchanged} • errors {maintenanceResult.errors}
                    {typeof (maintenanceResult as any).deleted === 'number' ? ` • deleted ${(maintenanceResult as any).deleted}` : ''}
                  </div>
                  {(maintenanceResult as any).message ? (
                    <div className="mt-1 text-sm text-[var(--muted)]">{(maintenanceResult as any).message}</div>
                  ) : null}
                  {maintenanceResult.examples.length ? (
                    <pre className="mt-3 max-h-56 overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-3 text-xs text-[var(--text)]">
                      {JSON.stringify(maintenanceResult.examples, null, 2)}
                    </pre>
                  ) : (
                    <div className="mt-2 text-xs text-[var(--muted)]">No changes needed.</div>
                  )}
                </div>
              ) : null}

              <div className="rounded-2xl border border-[var(--border-subtle)] p-4">
                <div className="text-sm font-semibold text-[var(--text)]">Cleanup test artifacts</div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Deletes only Workout Library rows with titles starting with "PW Publish Draft" and created within the last 30 days.
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={testArtifactsRunning}
                    onClick={() => void runPurgeTestArtifacts(false)}
                  >
                    {testArtifactsRunning ? 'Running…' : 'Dry-run cleanup'}
                  </Button>

                  <Input
                    placeholder='Type "DELETE" to enable'
                    value={testArtifactsConfirmText}
                    onChange={(e) => setTestArtifactsConfirmText(e.target.value)}
                  />

                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={
                      testArtifactsRunning ||
                      testArtifactsConfirmText.trim().toUpperCase() !== 'DELETE'
                    }
                    onClick={() => void runPurgeTestArtifacts(true)}
                  >
                    {testArtifactsRunning ? 'Deleting…' : 'Delete test artifacts'}
                  </Button>
                </div>

                {testArtifactsError ? <div className="mt-2 text-sm text-red-600">{testArtifactsError}</div> : null}

                {testArtifactsResult ? (
                  <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-3 text-xs text-[var(--text)]">
                    <div>
                      dryRun={String(testArtifactsResult.dryRun)} • matched={testArtifactsResult.matchedCount} • deleted=
                      {testArtifactsResult.deletedCount}
                    </div>
                    {testArtifactsResult.sampleTitles?.length ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer">Show sample titles</summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-white p-2 text-[11px] text-[var(--text)]">
                          {JSON.stringify(testArtifactsResult.sampleTitles, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
