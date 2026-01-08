'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { cn } from '@/lib/cn';

const DISCIPLINES = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;

type CreateAthleteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: any) => Promise<void>;
};

export function CreateAthleteModal({ isOpen, onClose, onCreate }: CreateAthleteModalProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [selectedDisciplines, setSelectedDisciplines] = useState<string[]>([]);
  const [planCadenceDays, setPlanCadenceDays] = useState('7');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [coachNotes, setCoachNotes] = useState('');
  const [goalsText, setGoalsText] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (selectedDisciplines.length === 0) {
      setError('At least one discipline is required');
      return;
    }

    const cadence = Number(planCadenceDays);
    if (!Number.isFinite(cadence) || cadence < 1 || cadence > 42) {
      setError('Program Cadence must be between 1 and 42 days');
      return;
    }

    const payload: any = {
      email: email.trim(),
      name: name.trim(),
      timezone: timezone.trim(),
      disciplines: selectedDisciplines,
      planCadenceDays: cadence,
    };

    if (goalsText.trim()) {
      payload.goalsText = goalsText.trim();
    }

    setCreating(true);
    try {
      await onCreate(payload);
      // Reset form
      setEmail('');
      setName('');
      setTimezone('America/New_York');
      setSelectedDisciplines([]);
      setPlanCadenceDays('7');
      setDateOfBirth('');
      setCoachNotes('');
      setGoalsText('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create athlete');
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (!creating) {
      onClose();
    }
  };

  const toggleDiscipline = (discipline: string) => {
    setSelectedDisciplines((prev) =>
      prev.includes(discipline)
        ? prev.filter((d) => d !== discipline)
        : [...prev, discipline]
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">New Athlete</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={creating}
            className="text-2xl leading-none text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Email *</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="athlete@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Timezone *</label>
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
              placeholder="America/New_York"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Disciplines *</label>
            <div className="flex flex-wrap gap-2">
              {DISCIPLINES.map((disc) => {
                const theme = getDisciplineTheme(disc);
                const isSelected = selectedDisciplines.includes(disc);
                return (
                  <button
                    key={disc}
                    type="button"
                    onClick={() => toggleDiscipline(disc)}
                    className={cn(
                      'flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm font-medium transition-all',
                      isSelected
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-white/30 bg-white/40 text-slate-700 hover:border-slate-300 hover:bg-white/60'
                    )}
                  >
                    <Icon name={theme.iconName} className="text-base" />
                    {disc}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Program Cadence (days) *</label>
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
            <label className="mb-1 block text-sm font-medium">Date of Birth</label>
            <Input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
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

          <div>
            <label className="mb-1 block text-sm font-medium">Coach Notes</label>
            <Textarea
              value={coachNotes}
              onChange={(e) => setCoachNotes(e.target.value)}
              placeholder="Private notes..."
              rows={3}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create Athlete'}
            </Button>
            <Button type="button" variant="secondary" onClick={handleClose} disabled={creating}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
