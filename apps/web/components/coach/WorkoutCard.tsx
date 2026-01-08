import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

type WorkoutCardProps = {
  id: string;
  time: string | null;
  title: string;
  discipline: string;
  hasAdvice: boolean;
  painFlag?: boolean;
  onClick: () => void;
};

export function WorkoutCard({ time, title, discipline, hasAdvice, painFlag = false, onClick }: WorkoutCardProps) {
  const theme = getDisciplineTheme(discipline);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl border border-white/30 bg-white/60 p-3 text-left shadow-sm backdrop-blur-xl transition-all hover:border-white/50 hover:bg-white/70 hover:shadow-md',
        'border-l-4',
        theme.accentClass,
        theme.bgClass
      )}
    >
      <div className="flex items-start gap-2">
        <Icon name={theme.iconName} size="sm" className={`${theme.textClass} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          {time ? <p className="text-xs font-medium text-[var(--muted)]">{time}</p> : null}
          <p className="truncate text-sm font-semibold">{title}</p>
        </div>
        <span className={cn('shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold', theme.textClass, theme.bgClass)}>
          {theme.badgeText}
        </span>
      </div>
      {(hasAdvice || painFlag) ? (
        <div className="mt-2 flex items-center gap-2">
          {painFlag ? (
            <div className="flex items-center gap-1">
              <Icon name="painFlag" size="sm" className="text-rose-500" />
              <span className="text-xs text-rose-600">Pain</span>
            </div>
          ) : null}
          {hasAdvice ? (
            <div className="flex items-center gap-1">
              <Icon name="coachAdvice" size="sm" className="text-amber-600" />
              <span className="text-xs text-amber-600">Advice</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}
