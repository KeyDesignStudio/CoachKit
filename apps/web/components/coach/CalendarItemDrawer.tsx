'use client';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { formatDisplay } from '@/lib/client-date';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  plannedStartTimeLocal: string | null;
  discipline: string;
  status: string;
  notes: string | null;
  latestCompletedActivity?: {
    painFlag: boolean;
  } | null;
  hasAthleteComment?: boolean;
  coachAdvicePresent?: boolean;
};

type CalendarItemDrawerProps = {
  item: CalendarItem | null;
  onClose: () => void;
  onSave: () => void;
};

export function CalendarItemDrawer({ item, onClose, onSave }: CalendarItemDrawerProps) {
  if (!item) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex flex-col gap-6 p-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const theme = getDisciplineTheme(item.discipline);
                  return <Icon name={theme.iconName} size="md" className={theme.textClass} />;
                })()}
                <h2 className="text-2xl font-semibold text-[var(--text)]">{item.title}</h2>
                <Badge>{item.discipline}</Badge>
                <Badge>{item.status.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {formatDisplay(item.date)} · {item.plannedStartTimeLocal ?? 'n/a'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2 text-sm hover:bg-[var(--bg-structure)]"
            >
              ✕
            </button>
          </div>

          {/* Coach Advice */}
          {item.coachAdvicePresent && item.notes && (
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                <Icon name="coachAdvice" size="sm" className="text-amber-600" />
                Coach Advice
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text)]">{item.notes}</p>
            </section>
          )}

          {/* Pain Flag Alert */}
          {item.latestCompletedActivity?.painFlag && (
            <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
              <div className="flex items-center gap-2">
                <Icon name="painFlag" size="sm" className="text-rose-500" />
                <p className="text-sm text-rose-600 font-medium">Athlete reported pain or discomfort</p>
              </div>
            </section>
          )}

          {/* Athlete Comments */}
          {item.hasAthleteComment && (
            <section className="rounded-2xl border border-blue-300/50 bg-blue-50/50 p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                <Icon name="athleteComment" size="sm" className="text-blue-600" />
                Athlete Commented
              </h3>
              <p className="mt-2 text-sm text-[var(--muted)]">View full details in Review Board</p>
            </section>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                // TODO: Implement full edit functionality
                alert('Edit functionality coming soon. Use main calendar for detailed editing.');
                onClose();
              }}
              className="flex-1"
            >
              Edit in Main Calendar
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
