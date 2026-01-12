import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';

type SessionChipProps = {
  time: string | null;
  title: string;
  discipline: string;
  status: string;
  hasAthleteComment?: boolean;
  painFlag?: boolean;
  onClick: () => void;
};

export function SessionChip({
  time,
  title,
  discipline,
  status,
  hasAthleteComment = false,
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
          <Icon name="painFlag" size="xs" className={`text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Pain flagged" aria-hidden={false} />
        )}
        {hasAthleteComment && (
          <Icon name="athleteComment" size="xs" className={`text-blue-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Has athlete comment" aria-hidden={false} />
        )}
        {status === 'COMPLETED_MANUAL' || status === 'COMPLETED_SYNCED' ? (
          <Icon name="completed" size="xs" className={`text-green-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Completed" aria-hidden={false} />
        ) : status === 'COMPLETED_SYNCED_DRAFT' ? (
          <Icon name="needsReview" size="xs" className={`text-amber-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Strava detected" aria-hidden={false} />
        ) : status === 'SKIPPED' ? (
          <Icon name="skipped" size="xs" className={`text-gray-500 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Skipped" aria-hidden={false} />
        ) : null}
      </div>
    </button>
  );
}
