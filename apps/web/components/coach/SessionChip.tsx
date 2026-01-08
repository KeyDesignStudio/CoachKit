import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';

type SessionChipProps = {
  time: string | null;
  title: string;
  discipline: string;
  status: string;
  hasAthleteComment?: boolean;
  coachAdvicePresent?: boolean;
  painFlag?: boolean;
  onClick: () => void;
};

export function SessionChip({
  time,
  title,
  discipline,
  status,
  hasAthleteComment = false,
  coachAdvicePresent = false,
  painFlag = false,
  onClick,
}: SessionChipProps) {
  const theme = getDisciplineTheme(discipline);
  
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative mb-1.5 flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/50 p-1.5 hover:bg-white/70 transition-colors text-left w-full"
    >
      <div className={`flex items-center gap-1.5 flex-1 min-w-0 border-l-2 ${theme.accentClass} pl-1.5`}>
        <Icon name={theme.iconName} size="sm" className={`${theme.textClass} flex-shrink-0`} />
        <span className="text-xs text-[var(--muted)] flex-shrink-0">{time || '—'}</span>
        <span className="flex-1 truncate text-xs text-[var(--text)]">{title}</span>
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {painFlag && (
          <Icon name="painFlag" size="sm" className="text-rose-500" aria-label="Pain flagged" aria-hidden={false} />
        )}
        {coachAdvicePresent && (
          <Icon name="coachAdvice" size="sm" className="text-amber-600" aria-label="Has coach advice" aria-hidden={false} />
        )}
        {hasAthleteComment && (
          <Icon name="athleteComment" size="sm" className="text-blue-600" aria-label="Has athlete comment" aria-hidden={false} />
        )}
        {status === 'COMPLETED_MANUAL' || status === 'COMPLETED_SYNCED' ? (
          <Icon name="completed" size="sm" className="text-green-600" aria-label="Completed" aria-hidden={false} />
        ) : status === 'SKIPPED' ? (
          <Icon name="skipped" size="sm" className="text-gray-500" aria-label="Skipped" aria-hidden={false} />
        ) : null}
      </div>
    </button>
  );
}
