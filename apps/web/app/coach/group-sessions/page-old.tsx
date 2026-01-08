'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useUser } from '@/components/user-context';
import { addDays, startOfWeek, toDateInput } from '@/lib/client-date';

const WEEKDAY_OPTIONS = [
  { label: 'Mon', value: 'MO' },
  { label: 'Tue', value: 'TU' },
  { label: 'Wed', value: 'WE' },
  { label: 'Thu', value: 'TH' },
  { label: 'Fri', value: 'FR' },
  { label: 'Sat', value: 'SA' },
  { label: 'Sun', value: 'SU' },
];

const DAY_ORDER = WEEKDAY_OPTIONS.map((option) => option.value);
const DAY_LABEL: Record<string, string> = WEEKDAY_OPTIONS.reduce((acc, option) => ({ ...acc, [option.value]: option.label }), {});

type GroupVisibility = 'ALL' | 'SQUAD' | 'SELECTED';

type AthleteOption = {
  user: {
    id: string;
    name: string | null;
  };
};

type GroupSessionTarget = {
  id: string;
  athleteId: string | null;
  squadId: string | null;
  athlete?: {
    user: {
      id: string;
      name: string | null;
    } | null;
  } | null;
  squad?: {
    id: string;
    name: string;
  } | null;
};

type GroupSessionRecord = {
  id: string;
  title: string;
  discipline: string;
  location: string | null;
  startTimeLocal: string;
  durationMinutes: number;
  description: string | null;
  recurrenceRule: string;
  visibilityType: GroupVisibility;
  optionalFlag: boolean;
  targets: GroupSessionTarget[];
};

type SessionFormState = {
  title: string;
  discipline: string;
  location: string;
  startTimeLocal: string;
  durationMinutes: string;
  description: string;
  optionalFlag: boolean;
  selectedDays: string[];
  visibilityType: GroupVisibility;
  targetAthleteIds: string[];
  squadInput: string;
};

type ApplyResult = {
  createdCount: number;
  skippedExistingCount: number;
  createdIds: string[];
};

type ApplyState = {
  from: string;
  to: string;
  loading: boolean;
  result?: ApplyResult;
  error?: string;
};

const defaultFormState = (): SessionFormState => ({
  title: '',
  discipline: '',
  location: '',
  startTimeLocal: '05:30',
  durationMinutes: '60',
  description: '',
  optionalFlag: false,
  selectedDays: ['MO'],
  visibilityType: 'ALL',
  targetAthleteIds: [],
  squadInput: '',
});

const defaultApplyRange = () => {
  const monday = startOfWeek();
  return { from: toDateInput(monday), to: toDateInput(addDays(monday, 28)) };
};

const defaultApplyState = (): ApplyState => ({
  ...defaultApplyRange(),
  loading: false,
});

function parseRuleDays(rule: string): string[] {
  if (!rule) {
    return [];
  }

  const parts = rule.split(';');
  const byDay = parts
    .map((part) => part.trim())
    .map((part) => part.split('='))
    .find(([key]) => key?.toUpperCase() === 'BYDAY');

  if (!byDay || !byDay[1]) {
    return [];
  }

  return byDay[1]
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => DAY_ORDER.includes(token));
}

function describeRecurrence(rule: string): string {
  const days = parseRuleDays(rule);
  if (!days.length) {
    return 'Weekly';
  }

  const labels = days.map((day) => DAY_LABEL[day] ?? day);
  return `Weekly on ${labels.join(', ')}`;
}

function formatTargets(session: GroupSessionRecord): string {
  if (session.visibilityType === 'ALL') {
    return 'All coached athletes';
  }

  if (session.visibilityType === 'SELECTED') {
    const names = session.targets
      .filter((target) => target.athleteId)
      .map((target) => target.athlete?.user?.name ?? target.athlete?.user?.id ?? target.athleteId ?? 'Unknown');
    return names.length ? names.join(', ') : 'Selected athletes';
  }

  const squads = session.targets
    .filter((target) => target.squadId)
    .map((target) => target.squad?.name ?? target.squadId ?? 'Squad');
  return squads.length ? `Squads: ${squads.join(', ')}` : 'Squad visibility';
}

function toggleWeekday(days: string[], value: string) {
  const set = new Set(days);
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }

  return Array.from(set).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

function buildWeeklyRule(days: string[]) {
  const unique = Array.from(new Set(days)).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return `FREQ=WEEKLY;BYDAY=${unique.join(',')}`;
}

function parseSquadIds(input: string) {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function sessionToForm(session: GroupSessionRecord): SessionFormState {
  const selectedDays = parseRuleDays(session.recurrenceRule);
  return {
    title: session.title,
    discipline: session.discipline,
    location: session.location ?? '',
    startTimeLocal: session.startTimeLocal,
    durationMinutes: String(session.durationMinutes),
    description: session.description ?? '',
    optionalFlag: session.optionalFlag,
    selectedDays: selectedDays.length ? selectedDays : ['MO'],
    visibilityType: session.visibilityType,
    targetAthleteIds: session.targets
      .map((target) => target.athleteId)
      .filter((value): value is string => Boolean(value)),
    squadInput: session.targets
      .map((target) => target.squadId)
      .filter((value): value is string => Boolean(value))
      .join(', '),
  };
}

function firstSelectedAthleteId(session: GroupSessionRecord) {
  const firstTarget = session.targets.find((target) => target.athleteId);
  return firstTarget?.athleteId ?? null;
}

export default function CoachGroupSessionsPage() {
  const { user } = useUser();
  const { request } = useApi();
  const [sessions, setSessions] = useState<GroupSessionRecord[]>([]);
  const [athletes, setAthletes] = useState<AthleteOption[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [createForm, setCreateForm] = useState<SessionFormState>(() => defaultFormState());
  const [editForm, setEditForm] = useState<SessionFormState>(() => defaultFormState());
  const [editSessionId, setEditSessionId] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [applyStates, setApplyStates] = useState<Record<string, ApplyState>>({});
  const [calendarChoices, setCalendarChoices] = useState<Record<string, string>>({});

  const isCoach = user.role === 'COACH';

  const loadSessions = useCallback(async () => {
    if (!isCoach || !user.userId) {
      return;
    }

    setLoadingSessions(true);
    setPageError('');

    try {
      const data = await request<{ groupSessions: GroupSessionRecord[] }>('/api/coach/group-sessions');
      setSessions(data.groupSessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load group sessions.';
      setPageError(message);
    } finally {
      setLoadingSessions(false);
    }
  }, [isCoach, request, user.userId]);

  const loadAthletes = useCallback(async () => {
    if (!isCoach || !user.userId) {
      return;
    }

    try {
      const data = await request<{ athletes: AthleteOption[] }>('/api/coach/athletes');
      setAthletes(data.athletes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load athletes.';
      setPageError(message);
    }
  }, [isCoach, request, user.userId]);

  useEffect(() => {
    if (isCoach) {
      loadAthletes();
      loadSessions();
    }
  }, [isCoach, loadAthletes, loadSessions]);

  useEffect(() => {
    setApplyStates((prev) => {
      const next: Record<string, ApplyState> = {};
      sessions.forEach((session) => {
        next[session.id] = prev[session.id] ?? defaultApplyState();
      });
      return next;
    });
  }, [sessions]);

  const resetCreateForm = () => {
    setCreateForm(defaultFormState());
  };

  const clearEditSelection = () => {
    setEditSessionId('');
    setEditForm(defaultFormState());
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');

    if (!createForm.selectedDays.length) {
      setFormError('Select at least one weekday.');
      return;
    }

    const durationMinutes = Number(createForm.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setFormError('Duration must be a positive number of minutes.');
      return;
    }

    const payload: Record<string, unknown> = {
      title: createForm.title,
      discipline: createForm.discipline,
      startTimeLocal: createForm.startTimeLocal,
      durationMinutes,
      recurrenceRule: buildWeeklyRule(createForm.selectedDays),
      visibilityType: createForm.visibilityType,
      optionalFlag: createForm.optionalFlag,
    };

    if (createForm.location.trim()) {
      payload.location = createForm.location.trim();
    }

    if (createForm.description.trim()) {
      payload.description = createForm.description.trim();
    }

    if (createForm.visibilityType === 'SELECTED') {
      if (!createForm.targetAthleteIds.length) {
        setFormError('Choose at least one athlete for SELECTED visibility.');
        return;
      }
      payload.targetAthleteIds = createForm.targetAthleteIds;
    }

    if (createForm.visibilityType === 'SQUAD') {
      const squadIds = parseSquadIds(createForm.squadInput);
      if (!squadIds.length) {
        setFormError('Enter at least one squad ID for SQUAD visibility.');
        return;
      }
      payload.targetSquadIds = squadIds;
    }

    setCreateSubmitting(true);

    try {
      await request('/api/coach/group-sessions', {
        method: 'POST',
        data: payload,
      });
      setStatusMessage('Created group session.');
      resetCreateForm();
      await loadSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create group session.';
      setFormError(message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');

    if (!editSessionId) {
      return;
    }

    if (!editForm.selectedDays.length) {
      setFormError('Select at least one weekday.');
      return;
    }

    const durationMinutes = Number(editForm.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setFormError('Duration must be a positive number of minutes.');
      return;
    }

    const payload: Record<string, unknown> = {
      title: editForm.title,
      discipline: editForm.discipline,
      startTimeLocal: editForm.startTimeLocal,
      durationMinutes,
      recurrenceRule: buildWeeklyRule(editForm.selectedDays),
      visibilityType: editForm.visibilityType,
      optionalFlag: editForm.optionalFlag,
      location: editForm.location.trim() || null,
      description: editForm.description.trim() || null,
    };

    if (editForm.visibilityType === 'SELECTED') {
      if (!editForm.targetAthleteIds.length) {
        setFormError('Choose at least one athlete for SELECTED visibility.');
        return;
      }
      payload.targetAthleteIds = editForm.targetAthleteIds;
    }

    if (editForm.visibilityType === 'SQUAD') {
      const squadIds = parseSquadIds(editForm.squadInput);
      if (!squadIds.length) {
        setFormError('Enter at least one squad ID for SQUAD visibility.');
        return;
      }
      payload.targetSquadIds = squadIds;
    }

    setEditSubmitting(true);

    try {
      await request(`/api/coach/group-sessions/${editSessionId}`, {
        method: 'PATCH',
        data: payload,
      });
      setStatusMessage('Updated group session.');
      clearEditSelection();
      await loadSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update group session.';
      setFormError(message);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editSessionId) {
      return;
    }

    const confirmed = window.confirm('Delete this group session?');
    if (!confirmed) {
      return;
    }

    setDeleteLoading(true);
    setFormError('');
    setStatusMessage('');

    try {
      await request(`/api/coach/group-sessions/${editSessionId}`, { method: 'DELETE' });
      setStatusMessage('Deleted group session.');
      clearEditSelection();
      await loadSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete group session.';
      setFormError(message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleApplyChange = (sessionId: string, field: 'from' | 'to', value: string) => {
    setApplyStates((prev) => ({
      ...prev,
      [sessionId]: {
        ...(prev[sessionId] ?? defaultApplyState()),
        [field]: value,
      },
    }));
  };

  const handleApply = async (session: GroupSessionRecord) => {
    const state = applyStates[session.id] ?? defaultApplyState();
    if (!state.from || !state.to) {
      setApplyStates((prev) => ({
        ...prev,
        [session.id]: {
          ...state,
          error: 'Set both from and to dates.',
        },
      }));
      return;
    }

    setApplyStates((prev) => ({
      ...prev,
      [session.id]: {
        ...state,
        loading: true,
        error: '',
        result: undefined,
      },
    }));

    try {
      const result = await request<ApplyResult>(`/api/coach/group-sessions/${session.id}/apply`, {
        method: 'POST',
        data: { from: state.from, to: state.to },
      });

      setApplyStates((prev) => ({
        ...prev,
        [session.id]: {
          ...(prev[session.id] ?? state),
          loading: false,
          error: '',
          result,
          from: state.from,
          to: state.to,
        },
      }));

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply group session.';
      setApplyStates((prev) => ({
        ...prev,
        [session.id]: {
          ...(prev[session.id] ?? state),
          loading: false,
          error: message,
          result: undefined,
        },
      }));
    }
  };

  const selectForEdit = (session: GroupSessionRecord) => {
    setEditSessionId(session.id);
    setEditForm(sessionToForm(session));
  };

  const selectedEditTitle = useMemo(() => {
    if (!editSessionId) {
      return '';
    }
    const session = sessions.find((item) => item.id === editSessionId);
    return session?.title ?? '';
  }, [editSessionId, sessions]);

  if (!isCoach) {
    return <p>Please switch to a coach identity to manage group sessions.</p>;
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header>
        <h1 style={{ marginBottom: '0.25rem' }}>Coach · Group Sessions</h1>
        <p style={{ margin: 0, color: '#475569' }}>Create shared workouts, then apply them into athlete calendars.</p>
      </header>
      {pageError ? <p style={{ color: '#b91c1c' }}>{pageError}</p> : null}
      {statusMessage ? <p style={{ color: '#047857' }}>{statusMessage}</p> : null}
      {formError ? <p style={{ color: '#b45309' }}>{formError}</p> : null}
      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <form onSubmit={handleCreate} style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '1rem', background: '#ffffff' }}>
          <h2 style={{ marginTop: 0 }}>Create weekly session</h2>
          <SessionFormFields
            form={createForm}
            setForm={setCreateForm}
            athletes={athletes}
            disabled={createSubmitting}
          />
          <button type="submit" disabled={createSubmitting} style={{ marginTop: '0.75rem' }}>
            {createSubmitting ? 'Creating…' : 'Create group session'}
          </button>
        </form>
        <form onSubmit={handleEdit} style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '1rem', background: '#ffffff' }}>
          <h2 style={{ marginTop: 0 }}>Edit session</h2>
          {editSessionId ? (
            <p style={{ margin: '0 0 0.5rem', color: '#475569' }}>Editing: {selectedEditTitle || editSessionId}</p>
          ) : (
            <p style={{ margin: '0 0 0.5rem', color: '#94a3b8' }}>Select a session below to edit it here.</p>
          )}
          <SessionFormFields
            form={editForm}
            setForm={setEditForm}
            athletes={athletes}
            disabled={!editSessionId || editSubmitting || deleteLoading}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <button type="submit" disabled={!editSessionId || editSubmitting}>
              {editSubmitting ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={handleDelete} disabled={!editSessionId || deleteLoading}>
              {deleteLoading ? 'Deleting…' : 'Delete'}
            </button>
            <button type="button" onClick={clearEditSelection} disabled={!editSessionId}>
              Clear selection
            </button>
          </div>
        </form>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ marginBottom: 0 }}>Existing sessions</h2>
        {loadingSessions ? <p>Loading group sessions…</p> : null}
        {!loadingSessions && sessions.length === 0 ? <p>No group sessions yet. Create one to get started.</p> : null}
        {sessions.map((session) => {
          const applyState = applyStates[session.id] ?? defaultApplyState();
          const needsAthletePicker = session.visibilityType === 'ALL' || session.visibilityType === 'SQUAD';
          const calendarLinkAthleteId = session.visibilityType === 'SELECTED'
            ? firstSelectedAthleteId(session)
            : calendarChoices[session.id] ?? '';

          return (
            <article key={session.id} style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '1rem', background: '#ffffff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{session.title}</h3>
                  <p style={{ margin: '0.25rem 0', color: '#475569' }}>
                    {session.discipline} · {session.startTimeLocal} · {session.durationMinutes} min · {session.visibilityType}
                    {session.optionalFlag ? ' · Optional' : ''}
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#475569' }}>{describeRecurrence(session.recurrenceRule)}</p>
                  <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>{formatTargets(session)}</p>
                  {session.location ? (
                    <p style={{ margin: '0.25rem 0', fontSize: '0.85rem' }}>Location: {session.location}</p>
                  ) : null}
                  {session.description ? (
                    <p style={{ margin: '0.25rem 0', fontSize: '0.85rem', color: '#475569' }}>{session.description}</p>
                  ) : null}
                </div>
                <button type="button" onClick={() => selectForEdit(session)}>
                  Edit in panel
                </button>
              </div>
              <div style={{ borderTop: '1px solid #e2e8f0', marginTop: '0.75rem', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <label>
                    From
                    <input
                      type="date"
                      value={applyState.from}
                      onChange={(event) => handleApplyChange(session.id, 'from', event.target.value)}
                      style={{ marginLeft: '0.25rem' }}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={applyState.to}
                      onChange={(event) => handleApplyChange(session.id, 'to', event.target.value)}
                      style={{ marginLeft: '0.25rem' }}
                    />
                  </label>
                  <button type="button" onClick={() => handleApply(session)} disabled={applyState.loading}>
                    {applyState.loading ? 'Applying…' : 'Apply'}
                  </button>
                </div>
                {applyState.result ? (
                  <p style={{ margin: 0, color: '#047857', fontSize: '0.9rem' }}>
                    Created {applyState.result.createdCount} · Skipped {applyState.result.skippedExistingCount}
                  </p>
                ) : null}
                {applyState.error ? <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.9rem' }}>{applyState.error}</p> : null}
                {applyState.result ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    {needsAthletePicker ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        Athlete
                        <select
                          value={calendarChoices[session.id] ?? ''}
                          onChange={(event) =>
                            setCalendarChoices((prev) => ({
                              ...prev,
                              [session.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select…</option>
                          {athletes.map((athlete) => (
                            <option key={athlete.user.id} value={athlete.user.id}>
                              {athlete.user.name ?? athlete.user.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {calendarLinkAthleteId ? (
                      <Link href={`/coach/calendar?athleteId=${calendarLinkAthleteId}`} style={{ color: '#2563eb' }}>
                        View in athlete calendar →
                      </Link>
                    ) : (
                      needsAthletePicker && <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Select an athlete to open their calendar.</span>
                    )}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}

type SessionFormFieldsProps = {
  form: SessionFormState;
  setForm: React.Dispatch<React.SetStateAction<SessionFormState>>;
  athletes: AthleteOption[];
  disabled?: boolean;
};

function SessionFormFields({ form, setForm, athletes, disabled }: SessionFormFieldsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
        Title
        <input
          type="text"
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          disabled={disabled}
          required
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
        Discipline
        <input
          type="text"
          value={form.discipline}
          onChange={(event) => setForm((prev) => ({ ...prev, discipline: event.target.value }))}
          disabled={disabled}
          required
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
        Location
        <input
          type="text"
          value={form.location}
          onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
          disabled={disabled}
          placeholder="Track, pool, etc"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
        Start time (HH:MM)
        <input
          type="text"
          value={form.startTimeLocal}
          onChange={(event) => setForm((prev) => ({ ...prev, startTimeLocal: event.target.value }))}
          disabled={disabled}
          placeholder="05:30"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
        Duration (minutes)
        <input
          type="number"
          min={1}
          max={600}
          value={form.durationMinutes}
          onChange={(event) => setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
          disabled={disabled}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
        Description
        <textarea
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          disabled={disabled}
          rows={3}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
        <input
          type="checkbox"
          checked={form.optionalFlag}
          onChange={(event) => setForm((prev) => ({ ...prev, optionalFlag: event.target.checked }))}
          disabled={disabled}
        />
        Optional workout
      </label>
      <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.5rem' }} disabled={disabled}>
        <legend style={{ fontSize: '0.85rem' }}>Weekdays</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {WEEKDAY_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.selectedDays.includes(option.value)}
                onChange={() => setForm((prev) => ({ ...prev, selectedDays: toggleWeekday(prev.selectedDays, option.value) }))}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
        Visibility
        <select
          value={form.visibilityType}
          onChange={(event) => {
            const value = event.target.value as GroupVisibility;
            setForm((prev) => ({
              ...prev,
              visibilityType: value,
              targetAthleteIds: value === 'SELECTED' ? prev.targetAthleteIds : [],
              squadInput: value === 'SQUAD' ? prev.squadInput : '',
            }));
          }}
          disabled={disabled}
        >
          <option value="ALL">All athletes</option>
          <option value="SELECTED">Selected athletes</option>
          <option value="SQUAD">Squad IDs</option>
        </select>
      </label>
      {form.visibilityType === 'SELECTED' ? (
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Target athletes
          <select
            multiple
            value={form.targetAthleteIds}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                targetAthleteIds: Array.from(event.target.selectedOptions).map((option) => option.value),
              }))
            }
            disabled={disabled}
            size={Math.min(6, Math.max(3, athletes.length))}
          >
            {athletes.map((athlete) => (
              <option key={athlete.user.id} value={athlete.user.id}>
                {athlete.user.name ?? athlete.user.id}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {form.visibilityType === 'SQUAD' ? (
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.9rem' }}>
          Squad IDs (comma separated)
          <input
            type="text"
            value={form.squadInput}
            onChange={(event) => setForm((prev) => ({ ...prev, squadInput: event.target.value }))}
            disabled={disabled}
            placeholder="squad-123, squad-456"
          />
        </label>
      ) : null}
    </div>
  );
}
