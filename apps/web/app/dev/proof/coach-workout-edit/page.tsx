'use client';

import { useCallback, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';

import { CalendarItemDrawer } from '@/components/coach/CalendarItemDrawer';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export default function DevProofCoachWorkoutEditPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  if (process.env.NEXT_PUBLIC_SHOW_DEV_PAGES !== 'true') notFound();

  const item = useMemo(
    () => ({
      id: 'proof-coach-item-1',
      date: '2026-01-12',
      plannedStartTimeLocal: '06:30',
      discipline: 'RUN',
      status: 'PLANNED',
      title: 'Easy run',
      workoutDetail: 'Keep it conversational. Finish with 4×20s strides.',
      latestCompletedActivity: null,
      hasAthleteComment: false,
    }),
    []
  );

  const [open, setOpen] = useState(true);

  const onClose = useCallback(() => setOpen(false), []);
  const onSave = useCallback(() => {}, []);

  return (
    <div className="min-h-screen bg-[var(--bg-structure)] p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-[var(--text)]">Dev Proof: Coach Calendar Workout Edit</h1>
        <p className="text-sm text-[var(--muted)]">
          This fixture page renders the coach workout edit drawer with a non-empty <span className="font-medium">Workout Detail</span>.
          No icon is rendered based on Workout Detail presence.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          Open Drawer
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Close Drawer
        </Button>
      </div>

      {open ? <CalendarItemDrawer item={item} onClose={onClose} onSave={onSave} /> : null}
    </div>
  );
}
