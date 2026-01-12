'use client';

import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';

export const dynamic = 'force-dynamic';

export default function DevProofAthleteWorkoutDetailPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  if (process.env.NEXT_PUBLIC_SHOW_DEV_PAGES !== 'true') notFound();

  const discipline = 'RUN';
  const theme = getDisciplineTheme(discipline);

  return (
    <div className="min-h-screen bg-[var(--bg-structure)] p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-[var(--text)]">Dev Proof: Athlete Workout Detail</h1>
        <p className="text-sm text-[var(--muted)]">
          This fixture page mimics the athlete workout detail layout and shows the <span className="font-medium">Workout Detail</span> section.
          No icon is rendered based on Workout Detail presence.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5 flex flex-col gap-4">
          <Card className="rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name={theme.iconName} size="md" className={theme.textClass} />
                  <h2 className="text-xl font-semibold text-[var(--text)] truncate">Easy run</h2>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                  <span>Jan 12, 2026</span>
                  <span>·</span>
                  <span>Planned: 06:30</span>
                  <Badge>{discipline}</Badge>
                </div>
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Workout Detail</p>
                <p className="mt-1 text-sm text-[var(--text)]">Keep it conversational. Finish with 4×20s strides.</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-7 flex flex-col gap-4">
          <Card className="rounded-3xl">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Completion</h3>
            <div className="mt-3 flex items-center gap-3">
              <input id="painFlag" type="checkbox" className="h-4 w-4" checked={false} readOnly />
              <label htmlFor="painFlag" className="text-sm text-[var(--text)]">
                Felt pain or discomfort during this workout
              </label>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
