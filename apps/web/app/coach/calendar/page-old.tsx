'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useUser } from '@/components/user-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { WeekGrid } from '@/components/coach/WeekGrid';
import { DayColumn } from '@/components/coach/DayColumn';
import { WorkoutCard } from '@/components/coach/WorkoutCard';
import { SessionDrawer } from '@/components/coach/SessionDrawer';
import { addDays, formatDisplay, startOfWeek, toDateInput } from '@/lib/client-date';
import { cn } from '@/lib/cn';

const DISCIPLINE_OPTIONS = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;
const DEFAULT_DISCIPLINE = DISCIPLINE_OPTIONS[0];

type DisciplineOption = (typeof DISCIPLINE_OPTIONS)[number];

type AthleteOption = {
  user: {
    id: string;
    name: string | null;
  };
};

type CalendarItem = {
  id: string;
  date: string | Date;
  plannedStartTimeLocal: string | null;
  discipline: string;
  title: string;
  workoutDetail?: string | null;
  template?: { id: string; title: string } | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
};

type SessionFormState = {
  date: string;
  plannedStartTimeLocal: string;
  title: string;
  discipline: DisciplineOption | string;
  templateId: string;
  workoutDetail: string;
};

type WorkoutTitleOption = {
  id: string;
  discipline: string;
  title: string;
};

const toIsoDateString = (value: string | Date) => (typeof value === 'string' ? value : value.toISOString());

type CopyMode = 'skipExisting' | 'overwrite';

const emptyForm = (date: string): SessionFormState => ({
  date,
  plannedStartTimeLocal: '05:30',
  title: '',
  discipline: DEFAULT_DISCIPLINE,
  templateId: '',
  workoutDetail: '',
});

export default function CoachCalendarPage() {
  const { user } = useUser();
  const { request } = useApi();
  const [athletes, setAthletes] = useState<AthleteOption[]>([]);
  const [selectedAthleteId, setSelectedAthleteId] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [createForm, setCreateForm] = useState(() => emptyForm(toDateInput(startOfWeek())));
  const [editItemId, setEditItemId] = useState('');
  const [editForm, setEditForm] = useState(() => emptyForm(toDateInput(startOfWeek())));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copyFormOpen, setCopyFormOpen] = useState(false);
  const [copyForm, setCopyForm] = useState(() => ({
    fromWeekStart: toDateInput(startOfWeek()),
    toWeekStart: toDateInput(addDays(startOfWeek(), 7)),
    mode: 'skipExisting' as CopyMode,
  }));
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [copyError, setCopyError] = useState('');
  const [titleOptions, setTitleOptions] = useState<Record<string, WorkoutTitleOption[]>>({});
  const [titleInputs, setTitleInputs] = useState({ create: '', edit: '' });
  const [titleMessage, setTitleMessage] = useState('');
  const [titleLoadingDiscipline, setTitleLoadingDiscipline] = useState<string | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);
  const selectedItem = useMemo(() => items.find((item) => item.id === editItemId), [items, editItemId]);

  const weekRange = useMemo(() => {
    const from = toDateInput(weekStart);
    const to = toDateInput(addDays(weekStart, 6));
    return { from, to };
  }, [weekStart]);

  const ensureDiscipline = (value: string): DisciplineOption => {
    const normalized = (value || '').toUpperCase();
    return (DISCIPLINE_OPTIONS.find((option) => option === normalized) ?? DEFAULT_DISCIPLINE) as DisciplineOption;
  };

  const loadTitleOptions = useCallback(
    async (discipline: string, force = false) => {
      const key = ensureDiscipline(discipline);
      if (!force && titleOptions[key]) {
        return;
      }

      setTitleLoadingDiscipline(key);
      setTitleMessage('');

      try {
        const data = await request<{ titles: WorkoutTitleOption[] }>(`/api/coach/workout-titles?discipline=${key}`);
        const sorted = [...data.titles].sort((a, b) => a.title.localeCompare(b.title));
        setTitleOptions((prev) => ({ ...prev, [key]: sorted }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workout titles.');
      } finally {
        setTitleLoadingDiscipline((current) => (current === key ? null : current));
      }
    },
    [request, titleOptions]
  );

  const handleTitleInputChange = (form: 'create' | 'edit', value: string) => {
    setTitleInputs((prev) => ({ ...prev, [form]: value }));
  };

  const handleAddTitle = async (form: 'create' | 'edit') => {
    const titleValue = titleInputs[form].trim();

    if (!titleValue) {
      setError('Enter a title name first.');
      return;
    }

    const discipline = form === 'create' ? createForm.discipline : editForm.discipline;
    const key = ensureDiscipline(discipline);

    setTitleMessage('');

    try {
      const response = await request<{ title: WorkoutTitleOption }>('/api/coach/workout-titles', {
        method: 'POST',
        data: {
          discipline: key,
          title: titleValue,
        },
      });

      setTitleOptions((prev) => {
        const merged = [...(prev[key] ?? []), response.title].sort((a, b) => a.title.localeCompare(b.title));
        return { ...prev, [key]: merged };
      });

      setTitleInputs((prev) => ({ ...prev, [form]: '' }));
      if (form === 'create') {
        setCreateForm((prev) => ({ ...prev, discipline: key, title: response.title.title }));
      } else {
        setEditForm((prev) => ({ ...prev, discipline: key, title: response.title.title }));
      }

      setTitleMessage(`Added "${response.title.title}" to ${key} titles.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add title.');
    }
  };

  const handleDeleteTitle = async (form: 'create' | 'edit') => {
    const discipline = form === 'create' ? createForm.discipline : editForm.discipline;
    const key = ensureDiscipline(discipline);
    const currentTitle = form === 'create' ? createForm.title : editForm.title;
    const entry = (titleOptions[key] ?? []).find((option) => option.title === currentTitle);

    if (!entry) {
      setError('Select a saved title to delete.');
      return;
    }

    setTitleMessage('');

    try {
      await request(`/api/coach/workout-titles/${entry.id}`, { method: 'DELETE' });

      setTitleOptions((prev) => {
        const filtered = (prev[key] ?? []).filter((option) => option.id !== entry.id);
        return { ...prev, [key]: filtered };
      });

      if (form === 'create') {
        setCreateForm((prev) => ({ ...prev, title: '' }));
      } else {
        setEditForm((prev) => ({ ...prev, title: '' }));
      }

      setTitleMessage(`Deleted "${entry.title}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete title.');
    }
  };

  const canDeleteTitle = (discipline: string, title: string) => {
    const key = ensureDiscipline(discipline);
    return (titleOptions[key] ?? []).some((option) => option.title === title);
  };

  const updateFormDiscipline = (form: 'create' | 'edit', value: string) => {
    const normalized = ensureDiscipline(value);
    if (form === 'create') {
      setCreateForm((prev) => ({ ...prev, discipline: normalized, title: '' }));
    } else {
      setEditForm((prev) => ({ ...prev, discipline: normalized, title: '' }));
    }
    handleTitleInputChange(form, '');
    loadTitleOptions(normalized, true);
  };

  const loadAthletes = useCallback(async () => {
    if (user.role !== 'COACH' || !user.userId) {
      return;
    }

    try {
      const data = await request<{ athletes: AthleteOption[] }>('/api/coach/athletes');
      setAthletes(data.athletes);
      if (!selectedAthleteId && data.athletes.length > 0) {
        setSelectedAthleteId(data.athletes[0].user.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes.');
    }
  }, [request, selectedAthleteId, user.role, user.userId]);

  const loadCalendar = useCallback(async () => {
    if (!selectedAthleteId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await request<{ items: CalendarItem[] }>(
        `/api/coach/calendar?athleteId=${selectedAthleteId}&from=${weekRange.from}&to=${weekRange.to}`
      );
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar.');
    } finally {
      setLoading(false);
    }
  }, [request, selectedAthleteId, weekRange.from, weekRange.to]);

  useEffect(() => {
    loadAthletes();
  }, [loadAthletes]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    setCreateForm((prev) => ({ ...prev, date: weekRange.from }));
  }, [weekRange.from]);

  useEffect(() => {
    loadTitleOptions(createForm.discipline);
  }, [createForm.discipline, loadTitleOptions]);

  useEffect(() => {
    loadTitleOptions(editForm.discipline);
  }, [editForm.discipline, loadTitleOptions]);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedAthleteId = selectedAthleteId?.trim() || '';
    
    if (!trimmedAthleteId) {
      setError('Select an athlete first.');
      return;
    }

    if (!createForm.title) {
      setError('Choose a workout title before adding.');
      return;
    }

    try {
      const normalizedDiscipline = ensureDiscipline(createForm.discipline);
      await request('/api/coach/calendar-items', {
        method: 'POST',
        data: {
          athleteId: trimmedAthleteId,
          date: createForm.date,
          plannedStartTimeLocal: createForm.plannedStartTimeLocal || undefined,
          title: createForm.title,
          discipline: normalizedDiscipline,
          templateId: createForm.templateId || undefined,
          workoutDetail: createForm.workoutDetail.trim() ? createForm.workoutDetail.trim() : undefined,
        },
      });
      setCreateForm((prev) => ({ ...emptyForm(createForm.date), discipline: normalizedDiscipline }));
      await loadCalendar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create calendar item.');
    }
  };

  const onCopyWeek = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedAthleteId) {
      setCopyError('Select an athlete first.');
      return;
    }

    setCopyLoading(true);
    setCopyError('');
    setCopyMessage('');

    try {
      const result = await request<{ createdCount: number; skippedCount: number }>('/api/coach/calendar/copy-week', {
        method: 'POST',
        data: {
          athleteId: selectedAthleteId,
          fromWeekStart: copyForm.fromWeekStart,
          toWeekStart: copyForm.toWeekStart,
          mode: copyForm.mode,
        },
      });

      setCopyMessage(`Copied week: created ${result.createdCount}, skipped ${result.skippedCount}.`);
      setCopyFormOpen(false);
      await loadCalendar();
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy week.');
    } finally {
      setCopyLoading(false);
    }
  };

  const onSelectItem = (item: CalendarItem) => {
    setEditItemId(item.id);
    const isoDate = toIsoDateString(item.date);
    setEditForm({
      date: isoDate.slice(0, 10),
      plannedStartTimeLocal: item.plannedStartTimeLocal ?? '',
      title: item.title,
      discipline: ensureDiscipline(item.discipline),
      templateId: item.template?.id ?? '',
      workoutDetail: item.workoutDetail ?? '',
    });

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const onEdit = async (event: FormEvent) => {
    event.preventDefault();

    if (!editItemId) {
      return;
    }

    if (!editForm.title) {
      setError('Choose a workout title before saving.');
      return;
    }

    try {
      const normalizedDiscipline = ensureDiscipline(editForm.discipline);
      await request(`/api/coach/calendar-items/${editItemId}`, {
        method: 'PATCH',
        data: {
          date: editForm.date,
          plannedStartTimeLocal: editForm.plannedStartTimeLocal || null,
          title: editForm.title,
          discipline: normalizedDiscipline,
          templateId: editForm.templateId || null,
          workoutDetail: editForm.workoutDetail.trim() ? editForm.workoutDetail.trim() : null,
        },
      });
      setEditItemId('');
      await loadCalendar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update calendar item.');
    }
  };

  const onDelete = async () => {
    if (!editItemId) {
      return;
    }

    try {
      await request(`/api/coach/calendar-items/${editItemId}`, { method: 'DELETE' });
      setEditItemId('');
      await loadCalendar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete calendar item.');
    }
  };

  const createDisciplineKey = ensureDiscipline(createForm.discipline);
  const editDisciplineKey = ensureDiscipline(editForm.discipline);
  const createDisciplineTitles = titleOptions[createDisciplineKey] ?? [];
  const editDisciplineTitles = titleOptions[editDisciplineKey] ?? [];
  const isTitleLoading = (discipline: string) => titleLoadingDiscipline === ensureDiscipline(discipline);

  if (user.role !== 'COACH') {
    return <p className="text-[var(--muted)]">Please switch to a coach identity to manage calendars.</p>;
  }

  const toggleCopyForm = () => {
    if (copyFormOpen) {
      setCopyFormOpen(false);
      setCopyError('');
      return;
    }

    setCopyForm({
      fromWeekStart: toDateInput(weekStart),
      toWeekStart: toDateInput(addDays(weekStart, 7)),
      mode: 'skipExisting',
    });
    setCopyError('');
    setCopyFormOpen(true);
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/20 bg-white/40 px-6 py-5 backdrop-blur-3xl shadow-inner">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Planning</p>
            <h1 className="text-3xl font-semibold">Coach Calendar</h1>
            <p className="text-sm text-[var(--muted)]">Week of {weekRange.from}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex flex-col gap-2 text-[var(--muted)]">
              Athlete
              <Select value={selectedAthleteId} onChange={(event) => setSelectedAthleteId(event.target.value)}>
                <option value="">Select…</option>
                {athletes.map((athlete) => (
                  <option key={athlete.user.id} value={athlete.user.id}>
                    {athlete.user.name ?? athlete.user.id}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                ◀ Prev
              </Button>
              <Button type="button" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                Next ▶
              </Button>
            </div>
            <Button type="button" variant="secondary" onClick={toggleCopyForm}>
              {copyFormOpen ? 'Close copy week' : 'Copy week'}
            </Button>
          </div>
        </div>
        {copyMessage ? <p className="text-sm text-emerald-600">{copyMessage}</p> : null}
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--muted)]">Loading calendar…</p> : null}
      </header>
      {copyFormOpen ? (
        <Card className="rounded-3xl">
          <form onSubmit={onCopyWeek} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                From week (Mon)
                <Input
                  type="date"
                  value={copyForm.fromWeekStart}
                  onChange={(event) => setCopyForm((prev) => ({ ...prev, fromWeekStart: event.target.value }))}
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                To week (Mon)
                <Input
                  type="date"
                  value={copyForm.toWeekStart}
                  onChange={(event) => setCopyForm((prev) => ({ ...prev, toWeekStart: event.target.value }))}
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                Mode
                <Select value={copyForm.mode} onChange={(event) => setCopyForm((prev) => ({ ...prev, mode: event.target.value as CopyMode }))}>
                  <option value="skipExisting">Skip existing</option>
                  <option value="overwrite">Overwrite</option>
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={copyLoading || !selectedAthleteId}>
                {copyLoading ? 'Copying…' : 'Copy week'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCopyFormOpen(false);
                  setCopyError('');
                }}
                disabled={copyLoading}
              >
                Cancel
              </Button>
            </div>
            {copyError ? (
              <p className="text-sm text-rose-500">{copyError}</p>
            ) : (
              <p className="text-sm text-[var(--muted)]">Copies workouts from one Monday-starting week into another.</p>
            )}
          </form>
        </Card>
      ) : null}
      <section className="grid gap-4">
        {items.map((item) => (
          <Card
            key={item.id}
            onClick={() => onSelectItem(item)}
            className={cn(
              'rounded-3xl transition hover:-translate-y-0.5 hover:shadow-xl',
              editItemId === item.id ? 'ring-2 ring-[var(--primary)]' : 'ring-1 ring-white/10'
            )}
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-[var(--text)]">{item.title}</h2>
                <Badge>{item.discipline}</Badge>
              </div>
              <p className="text-sm text-[var(--muted)]">
                {formatDisplay(toIsoDateString(item.date))} · {item.plannedStartTimeLocal ?? 'n/a'}
              </p>
              {item.workoutDetail ? (
                <p className="text-sm text-[var(--text)]">
                  <span className="font-semibold">Workout detail: </span>
                  {item.workoutDetail}
                </p>
              ) : null}
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Tap to edit</p>
            </div>
          </Card>
        ))}
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl">
          <form onSubmit={onCreate} className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold">Add workout</h3>
              <p className="text-sm text-[var(--muted)]">Create a new assignment for the selected athlete.</p>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Date
              <Input type="date" value={createForm.date} onChange={(event) => setCreateForm({ ...createForm, date: event.target.value })} required />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Start time (local)
              <Input
                placeholder="05:30"
                value={createForm.plannedStartTimeLocal}
                onChange={(event) => setCreateForm({ ...createForm, plannedStartTimeLocal: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Discipline
              <Select value={createDisciplineKey} onChange={(event) => updateFormDiscipline('create', event.target.value)}>
                {DISCIPLINE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Workout title
              <Select value={createForm.title} required onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}>
                <option value="">Select a title</option>
                {createDisciplineTitles.map((option) => (
                  <option key={option.id} value={option.title}>
                    {option.title}
                  </option>
                ))}
                {createForm.title && !createDisciplineTitles.some((option) => option.title === createForm.title) ? (
                  <option value={createForm.title}>{createForm.title} (legacy)</option>
                ) : null}
              </Select>
            </label>
            {isTitleLoading(createDisciplineKey) ? <p className="text-xs text-[var(--muted)]">Loading titles…</p> : null}
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Add new title"
                value={titleInputs.create}
                onChange={(event) => handleTitleInputChange('create', event.target.value)}
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={() => handleAddTitle('create')} disabled={!titleInputs.create.trim()}>
                Add title
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleDeleteTitle('create')}
                disabled={!canDeleteTitle(createDisciplineKey, createForm.title)}
                title="Delete selected title"
              >
                🗑 Remove
              </Button>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Template ID (optional)
              <Input value={createForm.templateId} onChange={(event) => setCreateForm({ ...createForm, templateId: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Workout Detail
              <Textarea
                placeholder="Provide workout detail that athletes will see"
                value={createForm.workoutDetail}
                onChange={(event) => setCreateForm({ ...createForm, workoutDetail: event.target.value })}
              />
            </label>
            {titleMessage ? <p className="text-xs text-emerald-600">{titleMessage}</p> : null}
            {!selectedAthleteId ? <p className="text-xs text-rose-500">Select an athlete first</p> : null}
            <Button type="submit" disabled={!selectedAthleteId}>
              Add item
            </Button>
          </form>
        </Card>
        <Card className="rounded-3xl">
          <form ref={editFormRef} onSubmit={onEdit} className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold">Edit selection</h3>
              {editItemId ? (
                <p className="text-sm text-[var(--muted)]">Editing {selectedItem?.title ?? editItemId}</p>
              ) : (
                <p className="text-sm text-[var(--muted)]">Select a workout above to edit.</p>
              )}
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Date
              <Input type="date" value={editForm.date} onChange={(event) => setEditForm({ ...editForm, date: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Start time
              <Input value={editForm.plannedStartTimeLocal} onChange={(event) => setEditForm({ ...editForm, plannedStartTimeLocal: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Discipline
              <Select value={editDisciplineKey} onChange={(event) => updateFormDiscipline('edit', event.target.value)}>
                {DISCIPLINE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Workout title
              <Select value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}>
                <option value="">Select a title</option>
                {editDisciplineTitles.map((option) => (
                  <option key={option.id} value={option.title}>
                    {option.title}
                  </option>
                ))}
                {editForm.title && !editDisciplineTitles.some((option) => option.title === editForm.title) ? (
                  <option value={editForm.title}>{editForm.title} (legacy)</option>
                ) : null}
              </Select>
            </label>
            {isTitleLoading(editDisciplineKey) ? <p className="text-xs text-[var(--muted)]">Loading titles…</p> : null}
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Add new title"
                value={titleInputs.edit}
                onChange={(event) => handleTitleInputChange('edit', event.target.value)}
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={() => handleAddTitle('edit')} disabled={!titleInputs.edit.trim()}>
                Add title
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleDeleteTitle('edit')}
                disabled={!canDeleteTitle(editDisciplineKey, editForm.title)}
                title="Delete selected title"
              >
                🗑 Remove
              </Button>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Template ID
              <Input value={editForm.templateId} onChange={(event) => setEditForm({ ...editForm, templateId: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              Workout Detail
              <Textarea value={editForm.workoutDetail} onChange={(event) => setEditForm({ ...editForm, workoutDetail: event.target.value })} />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={!editItemId}>
                Save changes
              </Button>
              <Button type="button" variant="ghost" onClick={onDelete} disabled={!editItemId}>
                Delete
              </Button>
            </div>
          </form>
        </Card>
      </section>
    </section>
  );
}
