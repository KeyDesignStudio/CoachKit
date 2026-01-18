'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { CANONICAL_EQUIPMENT, type CanonicalEquipment } from '@/lib/workout-library-taxonomy';

type Discipline = 'RUN' | 'BIKE' | 'SWIM' | 'BRICK' | 'STRENGTH' | 'OTHER';

type LibraryItem = {
  id: string;
  title: string;
  discipline: Discipline;
  status?: 'DRAFT' | 'PUBLISHED';
  source?: 'MANUAL' | 'KAGGLE' | 'FREE_EXERCISE_DB';
  tags: string[];
  description: string;
  durationSec: number;
  intensityTarget: string;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  notes: string | null;
  equipment: string[];
  workoutStructure: unknown | null;
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

type FreeExerciseDbImportSummary = {
  source: 'FREE_EXERCISE_DB';
  dryRun: boolean;
  scanned: number;
  wouldCreate: number;
  wouldUpdate: number;
  skippedDuplicates: number;
  errors: number;
  sample: {
    creates: Array<{ title: string; fingerprint: string; tags: string[]; equipment: string[] }>;
    updates: Array<{ id: string; title: string; fingerprint: string; changedFields: string[] }>;
    skips: Array<{ id: string; title: string; fingerprint: string; reason: string }>;
  };
  message?: string;
};

type KaggleImportSummary = {
  source: 'KAGGLE';
  dryRun: boolean;
  scanned: number;
  valid: number;
  wouldCreate: number;
  createdCount: number;
  createdIds: string[];
  skippedExistingCount: number;
  skippedDuplicateInBatchCount: number;
  errorCount: number;
  errors: Array<{ index: number; message: string }>;
  sample: {
    creates: Array<{ title: string; fingerprint: string }>;
    skips: Array<{ title: string; fingerprint: string; reason: string }>;
  };
  message?: string;
};

const DISCIPLINES: Discipline[] = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'OTHER'];

function splitCommaList(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseOptionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
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
  const required = ['title', 'discipline', 'description', 'intensityTarget'];
  const missing = required.filter((k) => !header.includes(k));
  if (missing.length > 0) {
    errors.push(`Missing required columns: ${missing.join(', ')}`);
  }

  return { items, errors };
}

export function AdminWorkoutLibrary() {
  const { request } = useApi();

  const [q, setQ] = useState('');
  const [discipline, setDiscipline] = useState<string>('');
  const [tag, setTag] = useState('');

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
  const [tagsText, setTagsText] = useState('');
  const [description, setDescription] = useState('');
  const [durationSecText, setDurationSecText] = useState('');
  const [distanceMetersText, setDistanceMetersText] = useState('');
  const [elevationGainMetersText, setElevationGainMetersText] = useState('');
  const [intensityTarget, setIntensityTarget] = useState('');
  const [equipment, setEquipment] = useState<CanonicalEquipment[]>([]);
  const [notes, setNotes] = useState('');
  const [workoutStructureText, setWorkoutStructureText] = useState('');

  const [activeRightTab, setActiveRightTab] = useState<'edit' | 'import' | 'maintenance'>('edit');

  const [importDryRun, setImportDryRun] = useState(true);
  const [importConfirmApply, setImportConfirmApply] = useState(false);
  const [importSource, setImportSource] = useState<'MANUAL' | 'KAGGLE' | 'FREE_EXERCISE_DB'>('MANUAL');
  const [importItems, setImportItems] = useState<unknown[]>([]);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [isDryRunBusy, setIsDryRunBusy] = useState(false);
  const [isApplyBusy, setIsApplyBusy] = useState(false);

  const [freeExerciseDbDryRun, setFreeExerciseDbDryRun] = useState(true);
  const [freeExerciseDbConfirmApply, setFreeExerciseDbConfirmApply] = useState(false);
  const [freeExerciseDbLimitText, setFreeExerciseDbLimitText] = useState('50');
  const [freeExerciseDbOffsetText, setFreeExerciseDbOffsetText] = useState('0');
  const [freeExerciseDbRunning, setFreeExerciseDbRunning] = useState(false);
  const [freeExerciseDbError, setFreeExerciseDbError] = useState<string | null>(null);
  const [freeExerciseDbResult, setFreeExerciseDbResult] = useState<FreeExerciseDbImportSummary | null>(null);

  const [kaggleDryRun, setKaggleDryRun] = useState(true);
  const [kaggleConfirmApply, setKaggleConfirmApply] = useState(false);
  const [kaggleMaxRowsText, setKaggleMaxRowsText] = useState('200');
  const [kaggleOffsetText, setKaggleOffsetText] = useState('0');
  const [kaggleRunning, setKaggleRunning] = useState(false);
  const [kaggleError, setKaggleError] = useState<string | null>(null);
  const [kaggleResult, setKaggleResult] = useState<KaggleImportSummary | null>(null);

  const [maintenanceDryRun, setMaintenanceDryRun] = useState(true);
  const [maintenancePurgeSource, setMaintenancePurgeSource] = useState<'KAGGLE' | 'FREE_EXERCISE_DB'>('KAGGLE');
  const [maintenancePurgeConfirm, setMaintenancePurgeConfirm] = useState('');
  const [maintenanceRunning, setMaintenanceRunning] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceSummary | null>(null);

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
  }, [discipline, q, request, selectedId, tag]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const resetForm = useCallback(() => {
    setTitle('');
    setFormDiscipline('RUN');
    setTagsText('');
    setDescription('');
    setDurationSecText('');
    setDistanceMetersText('');
    setElevationGainMetersText('');
    setIntensityTarget('');
    setEquipment([]);
    setNotes('');
    setWorkoutStructureText('');
    setSaveError(null);
    setSaveOk(null);
  }, []);

  useEffect(() => {
    if (importDryRun) setImportConfirmApply(false);
  }, [importDryRun]);

  useEffect(() => {
    if (freeExerciseDbDryRun) setFreeExerciseDbConfirmApply(false);
  }, [freeExerciseDbDryRun]);

  useEffect(() => {
    if (kaggleDryRun) setKaggleConfirmApply(false);
  }, [kaggleDryRun]);

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
      setTagsText((item.tags ?? []).join(', '));
      setDescription(item.description ?? '');
      setDurationSecText(item.durationSec ? String(item.durationSec) : '');
      setDistanceMetersText(item.distanceMeters != null ? String(item.distanceMeters) : '');
      setElevationGainMetersText(item.elevationGainMeters != null ? String(item.elevationGainMeters) : '');
      setIntensityTarget(item.intensityTarget ?? '');
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
      setWorkoutStructureText(
        item.workoutStructure != null ? JSON.stringify(item.workoutStructure, null, 2) : ''
      );

      setSaveError(null);
      setSaveOk(null);
    },
    []
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
      const durationSec = parseOptionalNumber(durationSecText);
      const distanceMeters = parseOptionalNumber(distanceMetersText);
      const elevationGainMeters = parseOptionalNumber(elevationGainMetersText);

      let workoutStructure: unknown | null | undefined = undefined;
      const wsTrimmed = workoutStructureText.trim();
      if (wsTrimmed) {
        try {
          workoutStructure = JSON.parse(wsTrimmed);
        } catch {
          throw new Error('workoutStructure must be valid JSON (or empty).');
        }
      }

      const hasDuration = typeof durationSec === 'number' && durationSec > 0;
      const hasDistance = typeof distanceMeters === 'number' && distanceMeters > 0;
      if (!hasDuration && !hasDistance) {
        throw new Error('Provide durationSec or distanceMeters.');
      }

      const payload = {
        title: title.trim(),
        discipline: formDiscipline,
        tags,
        description: description.trim(),
        durationSec: hasDuration ? Math.round(durationSec!) : undefined,
        intensityTarget: intensityTarget.trim(),
        distanceMeters: hasDistance ? distanceMeters : null,
        elevationGainMeters: elevationGainMeters ?? null,
        notes: notes.trim() ? notes.trim() : null,
        equipment: equipmentPayload,
        workoutStructure: workoutStructure ?? null,
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
    description,
    distanceMetersText,
    elevationGainMetersText,
    equipment,
    fetchList,
    formDiscipline,
    intensityTarget,
    mode,
    notes,
    request,
    selectedId,
    tagsText,
    title,
    workoutStructureText,
    durationSecText,
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
            source: importSource,
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
    [fetchList, importConfirmApply, importItems, importSource, request]
  );

  const onImportFreeExerciseDb = useCallback(
    async (dryRun: boolean, confirmApplyOverride?: boolean) => {
      setFreeExerciseDbRunning(true);
      setFreeExerciseDbError(null);
      setFreeExerciseDbResult(null);

      const limit = Math.min(
        500,
        Math.max(1, Number.parseInt(freeExerciseDbLimitText.trim() || '50', 10) || 50)
      );
      const offset = Math.max(0, Number.parseInt(freeExerciseDbOffsetText.trim() || '0', 10) || 0);

      try {
        const data = await request<FreeExerciseDbImportSummary>(
          `/api/admin/workout-library/import/free-exercise-db`,
          {
            method: 'POST',
            data: {
              dryRun,
              confirmApply: dryRun ? false : (confirmApplyOverride ?? freeExerciseDbConfirmApply),
              limit,
              offset,
            },
          }
        );

        setFreeExerciseDbResult(data);

        if (!dryRun && (data.wouldCreate > 0 || data.wouldUpdate > 0)) {
          await fetchList();
        }
      } catch (error) {
        setFreeExerciseDbError(error instanceof Error ? error.message : 'Import failed.');
      } finally {
        setFreeExerciseDbRunning(false);
      }
    },
    [fetchList, freeExerciseDbConfirmApply, freeExerciseDbLimitText, freeExerciseDbOffsetText, request]
  );

  const onKaggleImport = useCallback(
    async (dryRun: boolean, confirmApplyOverride?: boolean) => {
      setKaggleRunning(true);
      setKaggleError(null);
      setKaggleResult(null);

      try {
        const maxRows = parseOptionalNumber(kaggleMaxRowsText) ?? 200;
        const offset = Math.max(0, Number.parseInt(kaggleOffsetText.trim() || '0', 10) || 0);

        const data = await request<KaggleImportSummary>(`/api/admin/workout-library/import/kaggle`, {
          method: 'POST',
          data: {
            dryRun,
            confirmApply: dryRun ? false : (confirmApplyOverride ?? kaggleConfirmApply),
            maxRows,
            offset,
          },
        });

        setKaggleResult(data);
        if (!dryRun && data.createdCount > 0) {
          await fetchList();
        }
      } catch (error) {
        setKaggleError(error instanceof Error ? error.message : 'Kaggle import failed.');
      } finally {
        setKaggleRunning(false);
      }
    },
    [fetchList, kaggleConfirmApply, kaggleMaxRowsText, kaggleOffsetText, request]
  );

  const onFileSelected = useCallback(async (file: File) => {
    setImportParseError(null);
    setImportResult(null);
    setImportItems([]);
    setFreeExerciseDbError(null);
    setFreeExerciseDbResult(null);
    setKaggleError(null);
    setKaggleResult(null);

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

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
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
                          {it.durationSec ? <span>{it.durationSec}s</span> : null}
                          {it.distanceMeters != null ? <span>{it.distanceMeters}m</span> : null}
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
              placeholder="Tags (comma-separated)"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />

            <Textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />

            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Input
                placeholder="durationSec"
                inputMode="numeric"
                value={durationSecText}
                onChange={(e) => setDurationSecText(e.target.value)}
              />
              <Input
                placeholder="distanceMeters"
                inputMode="decimal"
                value={distanceMetersText}
                onChange={(e) => setDistanceMetersText(e.target.value)}
              />
              <Input
                placeholder="elevationGainMeters"
                inputMode="decimal"
                value={elevationGainMetersText}
                onChange={(e) => setElevationGainMetersText(e.target.value)}
              />
            </div>

            <Input
              placeholder="Intensity target (e.g. Z2 / RPE 6-7 / CSS)"
              value={intensityTarget}
              onChange={(e) => setIntensityTarget(e.target.value)}
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

            <Textarea
              placeholder="workoutStructure JSON (optional)"
              value={workoutStructureText}
              onChange={(e) => setWorkoutStructureText(e.target.value)}
              rows={8}
            />

            {saveError ? <div className="text-sm text-red-600">{saveError}</div> : null}
            {saveOk ? <div className="text-sm text-green-700">{saveOk}</div> : null}

            <div className="flex items-center gap-2">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
              </Button>
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
              Safety: dry-run by default. Apply requires confirmation. Imports create DRAFT sessions and skip duplicates.
            </div>

            {(() => {
              const isRemote = importSource === 'KAGGLE' || importSource === 'FREE_EXERCISE_DB';
              const hasManualRows = importItems.length > 0;
              const busy = isDryRunBusy || isApplyBusy;

              const canDryRun = !busy && (isRemote || hasManualRows);
              const canApply = !busy && importConfirmApply && (isRemote || hasManualRows);

              const debugEnabled =
                process.env.NODE_ENV !== 'production' &&
                typeof window !== 'undefined' &&
                new URLSearchParams(window.location.search).has('debugImport');

              const runDryRun = async () => {
                if (!canDryRun) return;

                setIsDryRunBusy(true);
                try {
                  if (importSource === 'MANUAL') {
                    await onImportCall(true);
                    return;
                  }

                  if (importSource === 'FREE_EXERCISE_DB') {
                    await onImportFreeExerciseDb(true, false);
                    return;
                  }

                  await onKaggleImport(true, false);
                } finally {
                  setIsDryRunBusy(false);
                }
              };

              const runApply = async () => {
                if (!canApply) return;

                setIsApplyBusy(true);
                try {
                  if (importSource === 'MANUAL') {
                    await onImportCall(false);
                    return;
                  }

                  if (importSource === 'FREE_EXERCISE_DB') {
                    await onImportFreeExerciseDb(false, true);
                    return;
                  }

                  await onKaggleImport(false, true);
                } finally {
                  setIsApplyBusy(false);
                }
              };

              return (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
                        <span className="text-xs text-[var(--muted)]">Source</span>
                        <Select
                          data-testid="admin-import-source"
                          value={importSource}
                          onChange={(e) => {
                            setImportSource(e.target.value as typeof importSource);
                            setImportParseError(null);
                            setImportResult(null);
                            setImportConfirmApply(false);
                            setFreeExerciseDbError(null);
                            setFreeExerciseDbResult(null);
                            setKaggleError(null);
                            setKaggleResult(null);
                          }}
                        >
                          <option value="MANUAL">MANUAL</option>
                          <option value="KAGGLE">KAGGLE</option>
                          <option value="FREE_EXERCISE_DB">FREE_EXERCISE_DB</option>
                        </Select>
                      </label>

                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                          <input
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
                    </div>

                    <input
                      data-testid="admin-import-file"
                      type="file"
                      accept=".csv,.json,application/json,text/csv"
                      hidden={isRemote}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void onFileSelected(file);
                      }}
                    />

                    {isRemote ? (
                      <div data-testid="admin-import-file-helper" className="text-xs text-[var(--muted)]">
                        This source is loaded server-side. No file required.
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--muted)]">
                        Upload a CSV/JSON file once, then run a dry-run or import.
                      </div>
                    )}

                    {importSource === 'FREE_EXERCISE_DB' ? (
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
                          <span className="text-xs text-[var(--muted)]">Limit (max 500)</span>
                          <Input
                            value={freeExerciseDbLimitText}
                            onChange={(e) => setFreeExerciseDbLimitText(e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
                          <span className="text-xs text-[var(--muted)]">Offset</span>
                          <Input
                            value={freeExerciseDbOffsetText}
                            onChange={(e) => setFreeExerciseDbOffsetText(e.target.value)}
                          />
                        </label>
                      </div>
                    ) : null}

                    {importSource === 'KAGGLE' ? (
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
                          <span className="text-xs text-[var(--muted)]">Limit (default 200, max 2000)</span>
                          <Input value={kaggleMaxRowsText} onChange={(e) => setKaggleMaxRowsText(e.target.value)} />
                        </label>
                        <label className="flex flex-col gap-1 text-sm text-[var(--text)]">
                          <span className="text-xs text-[var(--muted)]">Offset</span>
                          <Input value={kaggleOffsetText} onChange={(e) => setKaggleOffsetText(e.target.value)} />
                        </label>
                      </div>
                    ) : null}

                    {!isRemote ? (
                      <div className="text-xs text-[var(--muted)]">Loaded rows: {importItems.length}</div>
                    ) : null}
                  </div>

                  {importParseError ? <div className="text-sm text-red-600">{importParseError}</div> : null}

                  {freeExerciseDbError ? <div className="text-sm text-red-600">{freeExerciseDbError}</div> : null}
                  {kaggleError ? <div className="text-sm text-red-600">{kaggleError}</div> : null}

                  {debugEnabled ? (
                    <div
                      data-testid="admin-import-debug"
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-3 text-xs text-[var(--text)]"
                    >
                      source={importSource} isRemote={String(isRemote)} busy={String(busy)} hasManualRows={String(
                        hasManualRows
                      )} confirmApply={String(importConfirmApply)} dryRunChecked={String(importDryRun)} canDryRun={String(
                        canDryRun
                      )} canApply={String(canApply)}
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <Button
                      data-testid="admin-import-primary"
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

            {importSource === 'MANUAL' && importResult ? (
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

            {importSource === 'FREE_EXERCISE_DB' && freeExerciseDbResult ? (
              <div className="rounded-2xl border border-[var(--border-subtle)] p-4">
                <div className="text-sm font-medium text-[var(--text)]">
                  Scanned {freeExerciseDbResult.scanned} • Create {freeExerciseDbResult.wouldCreate} • Update{' '}
                  {freeExerciseDbResult.wouldUpdate} • Skipped {freeExerciseDbResult.skippedDuplicates} • Errors{' '}
                  {freeExerciseDbResult.errors}
                </div>
                {freeExerciseDbResult.message ? (
                  <div className="mt-1 text-sm text-[var(--muted)]">{freeExerciseDbResult.message}</div>
                ) : null}
              </div>
            ) : null}

            {importSource === 'KAGGLE' && kaggleResult ? (
              <div className="rounded-2xl border border-[var(--border-subtle)] p-4">
                <div className="text-sm font-medium text-[var(--text)]">
                  Scanned {kaggleResult.scanned} • Valid {kaggleResult.valid} • Would create {kaggleResult.wouldCreate}
                </div>
                {kaggleResult.message ? (
                  <div className="mt-1 text-sm text-[var(--muted)]">{kaggleResult.message}</div>
                ) : null}
                {!kaggleResult.dryRun && kaggleResult.createdCount > 0 ? (
                  <div className="mt-1 text-sm text-green-700">Created {kaggleResult.createdCount} sessions.</div>
                ) : null}

                {kaggleResult.errorCount > 0 ? (
                  <div className="mt-3">
                    <div className="text-sm font-semibold text-[var(--text)]">Row errors</div>
                    <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--border-subtle)]">
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {kaggleResult.errors.slice(0, 50).map((e) => (
                          <div key={`${e.index}-${e.message}`} className="px-3 py-2 text-xs text-red-700">
                            Row {e.index}: {e.message}
                          </div>
                        ))}
                        {kaggleResult.errors.length > 50 ? (
                          <div className="px-3 py-2 text-xs text-[var(--muted)]">Showing first 50 errors…</div>
                        ) : null}
                      </div>
                    </div>
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

              <div className="mt-2 rounded-2xl border border-[var(--border-subtle)] p-4">
                <div className="text-sm font-semibold text-[var(--text)]">Purge draft imports by source</div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Deletes all DRAFT sessions for a source. Run a dry-run first. Apply requires confirmation text.
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Select
                    value={maintenancePurgeSource}
                    onChange={(e) => setMaintenancePurgeSource(e.target.value as typeof maintenancePurgeSource)}
                  >
                    <option value="KAGGLE">KAGGLE</option>
                    <option value="FREE_EXERCISE_DB">FREE_EXERCISE_DB</option>
                  </Select>
                  <Input
                    placeholder="Type PURGE_KAGGLE to confirm"
                    value={maintenancePurgeConfirm}
                    onChange={(e) => setMaintenancePurgeConfirm(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={maintenanceRunning}
                    onClick={() =>
                      void runMaintenance('purgeDraftImportsBySource', maintenanceDryRun, {
                        source: maintenancePurgeSource,
                        confirm: maintenancePurgeConfirm,
                      })
                    }
                  >
                    Purge drafts
                  </Button>
                </div>
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
            </div>
          )
        )}
      </Card>
    </div>
  );
}
