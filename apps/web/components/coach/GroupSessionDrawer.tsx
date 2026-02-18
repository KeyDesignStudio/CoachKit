'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';

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

type GroupVisibility = 'ALL' | 'SQUAD' | 'SELECTED';

type AthleteOption = {
  user: {
    id: string;
    name: string | null;
  };
};

type SessionFormState = {
  title: string;
  discipline: string;
  location: string;
  startTimeLocal: string;
  durationMinutes: string;
  description: string;
  selectedDays: string[];
  visibilityType: GroupVisibility;
  targetAthleteIds: string[];
  squadInput: string;
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
  targets: GroupSessionTarget[];
};

type ApplyResult = {
  createdCount: number;
  skippedExistingCount: number;
  createdIds: string[];
};

type GroupSessionDrawerProps = {
  session: GroupSessionRecord | null;
  athletes: AthleteOption[];
  onClose: () => void;
  onSave: (sessionId: string, data: any) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
  onApply: (sessionId: string, from: string, to: string) => Promise<ApplyResult>;
};

function parseRuleDays(rule: string): string[] {
  if (!rule) return [];
  const parts = rule.split(';');
  const byDay = parts
    .map((part) => part.trim())
    .map((part) => part.split('='))
    .find(([key]) => key?.toUpperCase() === 'BYDAY');
  if (!byDay || !byDay[1]) return [];
  return byDay[1]
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => DAY_ORDER.includes(token));
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

function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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
    selectedDays: selectedDays.length ? selectedDays : ['MO'],
    visibilityType: session.visibilityType,
    targetAthleteIds: session.targets
      .map((target) => target.athleteId)
      .filter((value): value is string => Boolean(value)),
    squadInput: session.targets
      .map((target) => target.squadId)
      .filter(Boolean)
      .join(', '),
  };
}

export function GroupSessionDrawer({ session, athletes, onClose, onSave, onDelete, onApply }: GroupSessionDrawerProps) {
  const [form, setForm] = useState<SessionFormState>(
    session ? sessionToForm(session) : {
      title: '',
      discipline: '',
      location: '',
      startTimeLocal: '05:30',
      durationMinutes: '60',
      description: '',
      selectedDays: ['MO'],
      visibilityType: 'ALL',
      targetAthleteIds: [],
      squadInput: '',
    }
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [applyFrom, setApplyFrom] = useState('');
  const [applyTo, setApplyTo] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyError, setApplyError] = useState('');
  const [applyAthleteId, setApplyAthleteId] = useState('');

  // Update form when session changes
  useState(() => {
    if (session) {
      setForm(sessionToForm(session));
    }
  });

  useEffect(() => {
    if (!session) return;
    if (applyFrom && applyTo) return;
    const today = new Date();
    setApplyFrom(toDayKey(today));
    setApplyTo(toDayKey(addDays(today, 27)));
  }, [applyFrom, applyTo, session]);

  if (!session) return null;

  const toggleDay = (day: string) => {
    const set = new Set(form.selectedDays);
    if (set.has(day)) {
      set.delete(day);
    } else {
      set.add(day);
    }
    setForm({ ...form, selectedDays: Array.from(set).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)) });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.selectedDays.length) {
      setError('Select at least one weekday.');
      return;
    }

    const durationMinutes = Number(form.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setError('Duration must be a positive number.');
      return;
    }

    const payload: any = {
      title: form.title,
      discipline: form.discipline,
      startTimeLocal: form.startTimeLocal,
      durationMinutes,
      recurrenceRule: buildWeeklyRule(form.selectedDays),
      visibilityType: form.visibilityType,
      location: form.location.trim() || null,
      description: form.description.trim() || null,
    };

    if (form.visibilityType === 'SELECTED') {
      if (!form.targetAthleteIds.length) {
        setError('Choose at least one athlete for SELECTED visibility.');
        return;
      }
      payload.targetAthleteIds = form.targetAthleteIds;
    }

    if (form.visibilityType === 'SQUAD') {
      const squadIds = parseSquadIds(form.squadInput);
      if (!squadIds.length) {
        setError('Enter at least one squad ID for SQUAD visibility.');
        return;
      }
      payload.targetSquadIds = squadIds;
    }

    setSaving(true);
    try {
      await onSave(session.id, payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this group session? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await onDelete(session.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const handleApply = async () => {
    if (!applyFrom || !applyTo) {
      setApplyError('Select from and to dates');
      return;
    }
    setApplying(true);
    setApplyError('');
    setApplyResult(null);
    try {
      const result = await onApply(session.id, applyFrom, applyTo);
      setApplyResult(result);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setApplying(false);
    }
  };

  const applyPresetRange = (days: number) => {
    const today = new Date();
    setApplyFrom(toDayKey(today));
    setApplyTo(toDayKey(addDays(today, Math.max(0, days - 1))));
  };

  const applyCurrentMonth = () => {
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setApplyFrom(toDayKey(now));
    setApplyTo(toDayKey(monthEnd));
  };

  const needsAthletePicker = session.visibilityType === 'ALL' || session.visibilityType === 'SQUAD';
  const calendarLinkAthleteId = session.visibilityType === 'SELECTED'
    ? session.targets.find((t) => t.athleteId)?.athleteId || ''
    : applyAthleteId;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex flex-col gap-6 p-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Edit Group Session</h2>
              <p className="text-sm text-[var(--muted)]">{session.title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 hover:bg-[var(--bg-surface)]"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>

          {error && <p className="text-sm text-rose-500">{error}</p>}

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Session Details</h3>
              
              <div className="space-y-3">
                <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                  Title
                  <Input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    required
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                  Discipline
                  <Input
                    value={form.discipline}
                    onChange={(e) => setForm({ ...form, discipline: e.target.value })}
                    required
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                    Start Time
                    <Input
                      type="time"
                      value={form.startTimeLocal}
                      onChange={(e) => setForm({ ...form, startTimeLocal: e.target.value })}
                      required
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                    Duration (min)
                    <Input
                      type="number"
                      value={form.durationMinutes}
                      onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                      required
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                  Location (optional)
                  <Input
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                  {form.location.trim() ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.location.trim())}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--fg)] underline"
                    >
                      Open location in map
                    </a>
                  ) : null}
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                  Description (optional)
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={2}
                  />
                </label>

              </div>
            </div>

            {/* Weekdays */}
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Weekdays</h3>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.selectedDays.includes(day.value)
                        ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--muted)] hover:bg-[var(--bg-card)]'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Visibility */}
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Visibility</h3>
              
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                Type
                <Select
                  value={form.visibilityType}
                  onChange={(e) => setForm({ ...form, visibilityType: e.target.value as GroupVisibility })}
                >
                  <option value="ALL">All coached athletes</option>
                  <option value="SELECTED">Selected athletes</option>
                  <option value="SQUAD">Squad</option>
                </Select>
              </label>

              {form.visibilityType === 'SELECTED' && (
                <div className="mt-3">
                  <p className="mb-2 text-xs text-[var(--muted)]">Select athletes:</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
                    {athletes.map((athlete) => (
                      <label key={athlete.user.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.targetAthleteIds.includes(athlete.user.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setForm({ ...form, targetAthleteIds: [...form.targetAthleteIds, athlete.user.id] });
                            } else {
                              setForm({ ...form, targetAthleteIds: form.targetAthleteIds.filter((id) => id !== athlete.user.id) });
                            }
                          }}
                        />
                        {athlete.user.name || athlete.user.id}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.visibilityType === 'SQUAD' && (
                <div className="mt-3">
                  <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                    Squad IDs (comma-separated)
                    <Input
                      value={form.squadInput}
                      onChange={(e) => setForm({ ...form, squadInput: e.target.value })}
                      placeholder="squad-1, squad-2"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button type="submit" disabled={saving || deleting} variant="primary">
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button type="button" onClick={handleDelete} disabled={saving || deleting} variant="primary" className="bg-rose-500 hover:bg-rose-600">
                {deleting ? 'Deleting...' : 'Delete Session'}
              </Button>
              <Button type="button" onClick={onClose} variant="ghost">
                Cancel
              </Button>
            </div>
          </form>

          {/* Apply Section */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Apply to Calendars
            </h3>
            
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => applyPresetRange(28)}>
                  Next 4 weeks
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => applyPresetRange(56)}>
                  Next 8 weeks
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => applyPresetRange(84)}>
                  Next 12 weeks
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={applyCurrentMonth}>
                  This month
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                  From
                  <Input
                    type="date"
                    value={applyFrom}
                    onChange={(e) => setApplyFrom(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
                  To
                  <Input
                    type="date"
                    value={applyTo}
                    onChange={(e) => setApplyTo(e.target.value)}
                  />
                </label>
              </div>

              <Button
                type="button"
                onClick={handleApply}
                disabled={applying || !applyFrom || !applyTo}
                variant="secondary"
              >
                {applying ? 'Applying...' : 'Apply Sessions'}
              </Button>

              {applyResult && (
                <div className="rounded-lg bg-[var(--bg-success)] border border-[var(--border-subtle)] p-3 text-sm">
                  <p className="text-[var(--text-success)]">
                    Created {applyResult.createdCount} · Skipped {applyResult.skippedExistingCount}
                  </p>
                  {needsAthletePicker && (
                    <div className="mt-2">
                      <Select
                        value={applyAthleteId}
                        onChange={(e) => setApplyAthleteId(e.target.value)}
                        className="text-sm"
                      >
                        <option value="">Select athlete to view calendar</option>
                        {athletes.map((athlete) => (
                          <option key={athlete.user.id} value={athlete.user.id}>
                            {athlete.user.name || athlete.user.id}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  {calendarLinkAthleteId && (
                    <Link
                      href={`/coach/calendar?athlete=${calendarLinkAthleteId}`}
                      className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                    >
                      View calendar <Icon name="next" size="sm" />
                    </Link>
                  )}
                </div>
              )}

              {applyError && <p className="text-sm text-rose-500">{applyError}</p>}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
