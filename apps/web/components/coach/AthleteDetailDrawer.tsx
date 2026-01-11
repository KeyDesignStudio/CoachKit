'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { useApi } from '@/components/api-client';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { TimezoneSelect } from '@/components/TimezoneSelect';

const DISCIPLINES = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;

type AthleteProfile = {
  userId: string;
  coachId: string;
  disciplines: string[];
  goalsText?: string | null;
  planCadenceDays: number;
  dateOfBirth?: string | null;
  coachNotes?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    timezone: string;
  };
};

type PainHistoryItem = {
  calendarItemId: string;
  date: string;
  startTime: string;
  discipline: string;
  title: string;
  painFlag: boolean;
  athletePainComment?: string | null;
  commentDate?: string | null;
};

type JournalEntry = {
  id: string;
  entryDate: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type AthleteDetailDrawerProps = {
  isOpen: boolean;
  athleteId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

export function AthleteDetailDrawer({ isOpen, athleteId, onClose, onSaved, onDeleted }: AthleteDetailDrawerProps) {
  const { request } = useApi();
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null);
  const [painHistory, setPainHistory] = useState<PainHistoryItem[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalOpen, setJournalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [planCadenceDays, setPlanCadenceDays] = useState('7');
  const [selectedDisciplines, setSelectedDisciplines] = useState<string[]>([]);
  const [goalsText, setGoalsText] = useState('');
  const [coachNotes, setCoachNotes] = useState('');
  const [timezone, setTimezone] = useState('Australia/Brisbane');

  // Journal form
  const [newJournalDate, setNewJournalDate] = useState('');
  const [newJournalBody, setNewJournalBody] = useState('');
  const [addingJournal, setAddingJournal] = useState(false);
  const [journalDateError, setJournalDateError] = useState('');

  // Confirmation modals
  const [deleteAthleteConfirm, setDeleteAthleteConfirm] = useState(false);
  const [deleteJournalId, setDeleteJournalId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !athleteId) {
      setAthlete(null);
      setPainHistory([]);
      setJournalEntries([]);
      setError('');
      setJournalOpen(false);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setError('');
      try {
        const [athleteData, painData, journalData] = await Promise.all([
          request<{ athlete: AthleteProfile }>(`/api/coach/athletes/${athleteId}`),
          request<{ history: PainHistoryItem[] }>(`/api/coach/athletes/${athleteId}/pain-history`),
          request<{ entries: JournalEntry[] }>(`/api/coach/athletes/${athleteId}/journal`),
        ]);

        setAthlete(athleteData.athlete);
        setPainHistory(painData.history);
        setJournalEntries(journalData.entries);

        // Populate form
        setName(athleteData.athlete.user.name || '');
        setEmail(athleteData.athlete.user.email);
        setTimezone(athleteData.athlete.user.timezone || 'Australia/Brisbane');
        setDateOfBirth(athleteData.athlete.dateOfBirth ? athleteData.athlete.dateOfBirth.split('T')[0] : '');
        setPlanCadenceDays(String(athleteData.athlete.planCadenceDays));
        setSelectedDisciplines(athleteData.athlete.disciplines);
        setGoalsText(athleteData.athlete.goalsText || '');
        setCoachNotes(athleteData.athlete.coachNotes || '');

        // Set default journal date to today
        const today = new Date().toISOString().split('T')[0];
        setNewJournalDate(today);
        setJournalDateError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load athlete');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, athleteId, request]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!athleteId) return;

    setSaving(true);
    setError('');
    try {
      if (selectedDisciplines.length === 0) {
        throw new Error('At least one discipline is required');
      }

      const cadence = Number(planCadenceDays);
      if (!Number.isFinite(cadence) || cadence < 1 || cadence > 42) {
        throw new Error('Program Cadence must be between 1 and 42 days');
      }

      await request(`/api/coach/athletes/${athleteId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          timezone,
          disciplines: selectedDisciplines,
          goalsText: goalsText.trim() || null,
          planCadenceDays: cadence,
          dateOfBirth: dateOfBirth || null,
          coachNotes: coachNotes.trim() || null,
        }),
      });

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!athleteId) return;

    try {
      await request(`/api/coach/athletes/${athleteId}`, { method: 'DELETE' });
      setDeleteAthleteConfirm(false);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleteAthleteConfirm(false);
    }
  };

  const handleAddJournalEntry = async () => {
    if (!athleteId || !newJournalBody.trim()) return;

    // Validate date is not in the future
    const today = new Date().toISOString().split('T')[0];
    if (newJournalDate > today) {
      setJournalDateError('Entry date cannot be in the future');
      return;
    }
    setJournalDateError('');

    setAddingJournal(true);
    try {
      const result = await request<{ entry: JournalEntry }>(`/api/coach/athletes/${athleteId}/journal`, {
        method: 'POST',
        body: JSON.stringify({
          entryDate: newJournalDate,
          body: newJournalBody.trim(),
        }),
      });

      setJournalEntries([result.entry, ...journalEntries]);
      setNewJournalBody('');
      const today = new Date().toISOString().split('T')[0];
      setNewJournalDate(today);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add journal entry');
    } finally {
      setAddingJournal(false);
    }
  };

  const handleDeleteJournalConfirm = async () => {
    if (!athleteId || !deleteJournalId) return;

    try {
      await request(`/api/coach/athletes/${athleteId}/journal/${deleteJournalId}`, { method: 'DELETE' });
      setJournalEntries(journalEntries.filter((e) => e.id !== deleteJournalId));
      setDeleteJournalId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
      setDeleteJournalId(null);
    }
  };

  const toggleDiscipline = (discipline: string) => {
    setSelectedDisciplines((prev) =>
      prev.includes(discipline) ? prev.filter((d) => d !== discipline) : [...prev, discipline]
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 h-full overflow-y-auto border-l border-white/20 bg-white/90 backdrop-blur-3xl shadow-2xl transition-transform',
          'w-full',
          'lg:w-[50vw] lg:max-w-[840px]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/20 bg-white/60 px-6 py-4 backdrop-blur-xl">
          <h2 className="text-xl font-semibold">{name || 'Athlete Profile'}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6">
          {loading ? (
            <p className="text-center text-sm text-slate-500">Loading...</p>
          ) : error ? (
            <p className="text-center text-sm text-red-600">{error}</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Left Column: Profile */}
              <div className="space-y-6">
                {/* Profile Section */}
                <section className="space-y-4 rounded-2xl border border-white/30 bg-white/40 p-4">
                <h3 className="text-lg font-semibold">Profile</h3>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Email</label>
                    <Input value={email} disabled className="bg-slate-100/50" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Athlete timezone</label>
                    <p className="text-xs text-slate-500 mb-2">Affects Strava times and day boundaries (missed).</p>
                    <TimezoneSelect value={timezone} onChange={setTimezone} disabled={saving} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Date of Birth</label>
                    <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Program Cadence (days)</label>
                    <Input
                      type="number"
                      min="1"
                      max="42"
                      value={planCadenceDays}
                      onChange={(e) => setPlanCadenceDays(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Disciplines *</label>
                    <div className="flex flex-wrap gap-2">
                      {DISCIPLINES.map((discipline) => {
                        const theme = getDisciplineTheme(discipline);
                        const isSelected = selectedDisciplines.includes(discipline);
                        return (
                          <button
                            key={discipline}
                            type="button"
                            onClick={() => toggleDiscipline(discipline)}
                            className={cn(
                              'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all',
                              isSelected
                                ? 'border-blue-400 bg-blue-50 text-blue-700'
                                : 'border-white/30 bg-white/40 text-slate-600 hover:bg-white/60'
                            )}
                          >
                            <Icon name={theme.iconName} size="sm" className={isSelected ? theme.textClass : ''} />
                            {discipline}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Goals</label>
                    <Textarea
                      value={goalsText}
                      onChange={(e) => setGoalsText(e.target.value)}
                      placeholder="Athlete goals..."
                      rows={3}
                    />
                  </div>
                </div>
              </section>
              </div>

              {/* Right Column: Coach Notes, Pain History, Journal */}
              <div className="space-y-6">
                {/* Coach Notes Section */}
                <section className="space-y-4 rounded-2xl border border-white/30 bg-white/40 p-4">
                <h3 className="text-lg font-semibold">Coach Notes</h3>
                <Textarea
                  value={coachNotes}
                  onChange={(e) => setCoachNotes(e.target.value)}
                  placeholder="Private notes about this athlete..."
                  rows={4}
                />
              </section>

              {/* Pain History Section */}
              <section className="space-y-4 rounded-2xl border border-white/30 bg-white/40 p-4">
                <h3 className="text-lg font-semibold">Pain History</h3>
                {painHistory.length === 0 ? (
                  <p className="text-sm text-slate-500">No pain flags recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {painHistory.map((item) => {
                      const theme = getDisciplineTheme(item.discipline);
                      return (
                        <div
                          key={item.calendarItemId}
                          className="flex items-start gap-3 rounded-xl border border-white/30 bg-white/30 p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Icon name="painFlag" size="sm" className="text-rose-500" />
                            <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                          </div>
                          <div className="flex-1">
                            <div className="font-medium">{item.title}</div>
                            <div className="text-xs text-slate-600">{formatDate(item.date)}</div>
                            {item.athletePainComment && (
                              <div className="mt-1 italic text-slate-700">&quot;{item.athletePainComment}&quot;</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Coach Journal Section */}
              <section className="space-y-4 rounded-2xl border border-white/30 bg-white/40 p-4">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setJournalOpen(!journalOpen)}
                >
                  <h3 className="text-lg font-semibold">Coach Journal</h3>
                  <Icon
                    name="next"
                    size="sm"
                    className={cn('transition-transform', journalOpen ? 'rotate-90' : '')}
                  />
                </button>

                {journalOpen && (
                  <div className="space-y-4">
                    {/* Add Entry Form */}
                    <div className="space-y-2 rounded-xl border border-white/30 bg-white/30 p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium">Entry Date</label>
                        <Input
                          type="date"
                          value={newJournalDate}
                          onChange={(e) => {
                            setNewJournalDate(e.target.value);
                            setJournalDateError('');
                          }}
                          className="text-sm"
                        />
                        {journalDateError && (
                          <p className="mt-1 text-xs text-red-600">{journalDateError}</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">Entry</label>
                        <Textarea
                          value={newJournalBody}
                          onChange={(e) => setNewJournalBody(e.target.value)}
                          placeholder="Journal notes..."
                          rows={3}
                          className="text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddJournalEntry}
                        disabled={!newJournalBody.trim() || addingJournal || !!journalDateError}
                      >
                        {addingJournal ? 'Adding...' : 'Add Entry'}
                      </Button>
                    </div>

                    {/* Entries List */}
                    {journalEntries.length === 0 ? (
                      <p className="text-sm text-slate-500">No journal entries yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {journalEntries.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-xl border border-white/30 bg-white/30 p-3 text-sm"
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-xs font-medium text-slate-600">
                                {formatDate(entry.entryDate)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setDeleteJournalId(entry.id)}
                                className="text-xs text-red-600 hover:text-red-800"
                              >
                                Delete
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap text-slate-700">{entry.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap gap-3 border-t border-white/20 pt-6 mt-6">
            <Button type="submit" disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteAthleteConfirm(true)}
              disabled={loading}
            >
              Delete Athlete
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </form>
      </div>

      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={deleteAthleteConfirm}
        title="Delete Athlete"
        message={`Delete ${name}? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteAthleteConfirm(false)}
      />

      <ConfirmModal
        isOpen={deleteJournalId !== null}
        title="Delete Journal Entry"
        message="Delete this journal entry? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteJournalConfirm}
        onCancel={() => setDeleteJournalId(null)}
      />
    </>
  );
}
