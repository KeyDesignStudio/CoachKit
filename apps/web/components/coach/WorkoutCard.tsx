import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';
import { cn } from '@/lib/cn';

type WorkoutCardProps = {
  id: string;
  time: string | null;
  title: string;
  discipline: string;
  painFlag?: boolean;
  onClick: () => void;
};

function getDisciplineLabel(discipline: string): string {
  const d = (discipline || 'OTHER').toUpperCase();
  if (d === 'RUN' || d === 'BIKE' || d === 'SWIM' || d === 'REST') return d;
  if (d === 'BRICK') return 'BRICK';
  if (d === 'STRENGTH') return 'STR';
  return d.slice(0, 5);
}

export function WorkoutCard({ time, title, discipline, painFlag = false, onClick }: WorkoutCardProps) {
  const theme = getDisciplineTheme(discipline);
  const disciplineLabel = getDisciplineLabel(discipline);

  return (
    <button
      onClick={onClick}
      data-coach-workout-card="v2"
      className={cn(
        'w-full cursor-pointer text-left',
        'bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl px-2 py-1.5',
        'transition-shadow',
        'hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Icon + discipline label (stacked; stable) */}
        <div className="flex flex-col items-center justify-center w-11 flex-shrink-0">
          <Icon name={theme.iconName} size="sm" className={cn(theme.textClass, 'text-[16px] leading-none')} />
          <span className={cn('text-[10px] font-medium leading-none mt-0.5', theme.textClass)}>{disciplineLabel}</span>
        </div>

        {/* Time + title */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] leading-none text-[var(--muted)]">{time ?? ''}</p>
          <p className="text-xs font-normal md:truncate text-[var(--text)]">{title || disciplineLabel}</p>
        </div>

        {/* Indicators (right-aligned) */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {painFlag ? <Icon name="painFlag" size="xs" className={`leading-none text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} /> : null}
          <span className="w-[13px]" />
        </div>
      </div>
    </button>
  );
}
