'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

type Discipline = 'RUN' | 'BIKE' | 'SWIM' | 'BRICK' | 'STRENGTH' | 'OTHER';

type LibraryItem = {
  id: string;
  title: string;
  discipline: Discipline;
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

type ImportResult = {
  dryRun: boolean;
  totalCount: number;
  validCount: number;
  errorCount: number;
  preview: unknown[];
  errors: Array<{ index: number; message: string }>;
  createdCount: number;
  createdIds: string[];
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
  const [equipmentText, setEquipmentText] = useState('');
  const [notes, setNotes] = useState('');
  const [workoutStructureText, setWorkoutStructureText] = useState('');

  const [activeRightTab, setActiveRightTab] = useState<'edit' | 'import'>('edit');

  const [importDryRun, setImportDryRun] = useState(true);
  const [importItems, setImportItems] = useState<unknown[]>([]);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

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
    setEquipmentText('');
    setNotes('');
    setWorkoutStructureText('');
    setSaveError(null);
    setSaveOk(null);
  }, []);

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
      setEquipmentText((item.equipment ?? []).join(', '));
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
      const equipment = splitCommaList(equipmentText);
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
        equipment,
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
    equipmentText,
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
    [fetchList, importItems, request]
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

              {items.length === 0 ? (
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

            <Input
              placeholder="Equipment (comma-separated)"
              value={equipmentText}
              onChange={(e) => setEquipmentText(e.target.value)}
            />

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
          <div className="mt-4 flex flex-col gap-3">
            <div className="text-sm font-semibold text-[var(--text)]">Import (CSV or JSON)</div>
            <div className="text-xs text-[var(--muted)]">
              CSV headers should include: title, discipline, description, intensityTarget. Optional: tags, durationSec,
              distanceMeters, elevationGainMeters, notes, equipment, workoutStructure.
            </div>

            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept=".csv,.json,application/json,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFileSelected(file);
                }}
              />

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={importDryRun}
                    onChange={(e) => setImportDryRun(e.target.checked)}
                  />
                  Dry run
                </label>

                <div className="text-xs text-[var(--muted)]">Loaded rows: {importItems.length}</div>
              </div>
            </div>

            {importParseError ? <div className="text-sm text-red-600">{importParseError}</div> : null}

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={importing || importItems.length === 0}
                onClick={() => void onImportCall(true)}
              >
                Validate
              </Button>
              <Button
                size="sm"
                disabled={importing || importItems.length === 0}
                onClick={() => void onImportCall(importDryRun)}
              >
                {importing ? 'Working…' : importDryRun ? 'Run Dry-Run' : 'Import Now'}
              </Button>
            </div>

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
        )}
      </Card>
    </div>
  );
}
