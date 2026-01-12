'use client';

import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';
import { cn } from '@/lib/cn';

type ReviewChipProps = {
  time: string | null;
  title: string;
  discipline: string;
  hasAthleteComment: boolean;
  coachAdvicePresent: boolean;
  painFlag?: boolean;
  onClick: () => void;
  onQuickReview?: () => void;
};

export function ReviewChip({
  time: _time,
  title,
  discipline,
  hasAthleteComment,
  coachAdvicePresent,
  painFlag = false,
  onClick,
  onQuickReview,
}: ReviewChipProps) {
  const theme = getDisciplineTheme(discipline);

  const disciplineLabel = (discipline || 'OTHER').toUpperCase();

  return (
    <div className="group relative mb-1 flex items-center gap-1.5 rounded bg-[var(--bg-card)] p-1.5 transition-[background-color,box-shadow] hover:bg-[var(--bg-surface)] hover:shadow-sm">
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center gap-2 overflow-hidden text-left min-w-0"
      >
        {/* Left cluster: icon + discipline */}
        <div className="flex flex-col items-center justify-center w-10 flex-shrink-0">
          <Icon name={theme.iconName} size="sm" className={cn(theme.textClass, 'text-[16px] leading-none')} />
          <span className={cn('text-[10px] font-medium leading-none mt-0.5', theme.textClass)}>
            {disciplineLabel}
          </span>
        </div>

        {/* Main: title only (no time in overview) */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-normal truncate text-[var(--text)]">{title || disciplineLabel}</p>
        </div>

        {/* Right: status icons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {painFlag && (
            <Icon name="painFlag" size="xs" className={`text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Pain flagged" aria-hidden={false} />
          )}
          {coachAdvicePresent && (
            <Icon name="coachAdvice" size="xs" className={`text-amber-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Has coach advice" aria-hidden={false} />
          )}
          {hasAthleteComment && (
            <Icon name="athleteComment" size="xs" className={`text-blue-600 ${CALENDAR_ACTION_ICON_CLASS}`} aria-label="Has athlete comment" aria-hidden={false} />
          )}
        </div>
      </button>
      {!hasAthleteComment && onQuickReview && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQuickReview();
          }}
          className="opacity-0 group-hover:opacity-100 transition-[opacity,background-color,box-shadow] rounded bg-[var(--bg-card)] px-1.5 py-1 text-xs font-medium hover:bg-[var(--bg-structure)] hover:shadow-sm"
          title="Quick mark reviewed"
        >
          <Icon name="reviewed" size="xs" />
        </button>
      )}
    </div>
  );
}
