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
      className={
        'group relative mb-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left w-full ' +
        'bg-transparent hover:bg-[var(--bg-structure)] transition-colors'
      }
    >
      <span className={`${theme.textClass} flex-shrink-0 text-[16px] leading-none`}>
        <Icon name={theme.iconName} size="sm" className="text-[16px] leading-none" />
      </span>
      <span className="text-[10px] leading-none text-[var(--muted)] flex-shrink-0">{time || '—'}</span>
      <span className="flex-1 truncate text-xs text-[var(--text)] font-normal">{title}</span>
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
        ) : status === 'COMPLETED_SYNCED_DRAFT' ? (
          <Icon name="needsReview" size="sm" className="text-amber-600" aria-label="Strava detected" aria-hidden={false} />
        ) : status === 'SKIPPED' ? (
          <Icon name="skipped" size="sm" className="text-gray-500" aria-label="Skipped" aria-hidden={false} />
        ) : null}
      </div>
    </button>
  );
}
