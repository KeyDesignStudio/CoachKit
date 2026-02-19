'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import { LocationInputWithGeocode } from '@/components/coach/LocationInputWithGeocode';

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

type NearbyAthleteSuggestion = {
  athleteId: string;
  name: string;
  distanceKm: number;
};

type SessionFormState = {
  title: string;
  discipline: string;
  location: string;
  locationLat: number | null;
  locationLon: number | null;
  startTimeLocal: string;
  durationMinutes: string;
  distanceMeters: number | null;
  intensityTarget: string;
  tags: string[];
  equipment: string[];
  workoutStructure: unknown | null;
  notes: string;
  description: string;
  selectedDays: string[];
  visibilityType: GroupVisibility;
  targetAthleteIds: string[];
  squadInput: string;
};

type CreateSessionModalProps = {
  isOpen: boolean;
  athletes: AthleteOption[];
  onClose: () => void;
  onCreate: (data: any) => Promise<string>;
  initialValues?: Partial<SessionFormState> | null;
};

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

export function CreateSessionModal({ isOpen, athletes, onClose, onCreate, initialValues }: CreateSessionModalProps) {
  const defaultForm = useMemo<SessionFormState>(
    () => ({
      title: '',
      discipline: '',
      location: '',
      locationLat: null,
      locationLon: null,
      startTimeLocal: '05:30',
      durationMinutes: '60',
      distanceMeters: null,
      intensityTarget: '',
      tags: [],
      equipment: [],
      workoutStructure: null,
      notes: '',
      description: '',
      selectedDays: ['MO'],
      visibilityType: 'ALL',
      targetAthleteIds: [],
      squadInput: '',
    }),
    []
  );

  const [form, setForm] = useState<SessionFormState>(defaultForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [nearbySuggestions, setNearbySuggestions] = useState<NearbyAthleteSuggestion[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState('');

  // Re-initialize form each time the modal opens (supports template injection).
  useEffect(() => {
    if (!isOpen) return;
    const merged: SessionFormState = {
      ...defaultForm,
      ...(initialValues ?? {}),
      // Ensure arrays default correctly
      selectedDays: initialValues?.selectedDays?.length ? initialValues.selectedDays : defaultForm.selectedDays,
      targetAthleteIds: initialValues?.targetAthleteIds ?? defaultForm.targetAthleteIds,
    };
    setForm(merged);
    setError('');
    setNearbySuggestions([]);
    setNearbyError('');
  }, [defaultForm, initialValues, isOpen]);

  useEffect(() => {
    if (form.locationLat != null && form.locationLon != null) return;
    setNearbySuggestions([]);
  }, [form.locationLat, form.locationLon]);

  if (!isOpen) return null;

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
      distanceMeters: form.distanceMeters ?? undefined,
      intensityTarget: form.intensityTarget.trim() ? form.intensityTarget.trim() : undefined,
      tags: form.tags ?? [],
      equipment: form.equipment ?? [],
      workoutStructure: form.workoutStructure ?? undefined,
      notes: form.notes.trim() ? form.notes.trim() : undefined,
      recurrenceRule: buildWeeklyRule(form.selectedDays),
      visibilityType: form.visibilityType,
    };

    if (form.location.trim()) {
      payload.location = form.location.trim();
    }
    if (form.locationLat != null && form.locationLon != null) {
      payload.locationLat = form.locationLat;
      payload.locationLon = form.locationLon;
    }

    if (form.description.trim()) {
      payload.description = form.description.trim();
    }

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

    setCreating(true);
    try {
      await onCreate(payload);
      // Reset form
      setForm({
        title: '',
        discipline: '',
        location: '',
        locationLat: null,
        locationLon: null,
        startTimeLocal: '05:30',
        durationMinutes: '60',
        distanceMeters: null,
        intensityTarget: '',
        tags: [],
        equipment: [],
        workoutStructure: null,
        notes: '',
        description: '',
        selectedDays: ['MO'],
        visibilityType: 'ALL',
        targetAthleteIds: [],
        squadInput: '',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const fetchNearbyAthletes = async () => {
    if (form.locationLat == null || form.locationLon == null) {
      setNearbyError('Select a geocoded location first.');
      return;
    }

    setNearbyLoading(true);
    setNearbyError('');
    try {
      const response = await fetch(
        `/api/coach/group-sessions/proximity?lat=${encodeURIComponent(String(form.locationLat))}&lon=${encodeURIComponent(
          String(form.locationLon)
        )}&radiusKm=15&limit=20`,
        { method: 'GET', cache: 'no-store' }
      );
      if (!response.ok) {
        throw new Error('Failed to load nearby athletes.');
      }
      const json = (await response.json()) as { data?: { athletes?: NearbyAthleteSuggestion[] } };
      setNearbySuggestions(json?.data?.athletes ?? []);
    } catch (err) {
      setNearbySuggestions([]);
      setNearbyError(err instanceof Error ? err.message : 'Failed to load nearby athletes.');
    } finally {
      setNearbyLoading(false);
    }
  };

  const addNearbyToTargets = () => {
    const ids = nearbySuggestions.map((item) => item.athleteId);
    if (!ids.length) return;
    setForm((prev) => ({
      ...prev,
      targetAthleteIds: Array.from(new Set([...prev.targetAthleteIds, ...ids])),
    }));
  };

  const handleClose = () => {
    if (!creating) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 max-h-[90vh] overflow-y-auto rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex flex-col gap-6 p-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Create Group Session</h2>
              <p className="text-sm text-[var(--muted)]">Define a weekly recurring session</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={creating}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 hover:bg-[var(--bg-surface)] disabled:opacity-50"
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
                    autoFocus
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
                  <LocationInputWithGeocode
                    value={form.location}
                    onValueChange={(location) => setForm((prev) => ({ ...prev, location }))}
                    latitude={form.locationLat}
                    longitude={form.locationLon}
                    onCoordinatesChange={(locationLat, locationLon) => setForm((prev) => ({ ...prev, locationLat, locationLon }))}
                  />
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
                  <div className="mb-2 flex items-center gap-2">
                    <Button type="button" variant="secondary" className="min-h-[36px]" onClick={fetchNearbyAthletes} disabled={nearbyLoading}>
                      {nearbyLoading ? 'Finding nearby...' : 'Suggest nearby athletes'}
                    </Button>
                    {nearbySuggestions.length > 0 ? (
                      <Button type="button" variant="ghost" className="min-h-[36px]" onClick={addNearbyToTargets}>
                        Add all suggested
                      </Button>
                    ) : null}
                  </div>
                  {nearbyError ? <p className="mb-2 text-xs text-rose-500">{nearbyError}</p> : null}
                  {nearbySuggestions.length > 0 ? (
                    <div className="mb-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
                      <p className="text-xs text-[var(--muted)]">
                        Nearby ({nearbySuggestions.length}) within 15km: {nearbySuggestions.map((item) => `${item.name} (${item.distanceKm}km)`).join(', ')}
                      </p>
                    </div>
                  ) : null}
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
              <Button type="submit" disabled={creating} variant="primary">
                {creating ? 'Creating...' : 'Create Session'}
              </Button>
              <Button type="button" onClick={handleClose} disabled={creating} variant="ghost">
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
