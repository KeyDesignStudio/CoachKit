'use client';

import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { Icon } from '@/components/ui/Icon';

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
  time,
  title,
  discipline,
  hasAthleteComment,
  coachAdvicePresent,
  painFlag = false,
  onClick,
  onQuickReview,
}: ReviewChipProps) {
  const theme = getDisciplineTheme(discipline);

  return (
    <div className="group relative mb-2 flex items-center gap-2 rounded-xl border border-white/30 bg-white/50 p-2 hover:bg-white/70 transition-colors">
      <button
        type="button"
        onClick={onClick}
        className={`flex flex-1 items-center gap-2 overflow-hidden text-left border-l-4 ${theme.accentClass} pl-2`}
      >
        <Icon name={theme.iconName} size="sm" className={`${theme.textClass} flex-shrink-0`} />
        <span className="text-xs font-medium text-[var(--muted)]">{time || '—'}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${theme.bgClass} ${theme.textClass}`}>
          {theme.badgeText}
        </span>
        <span className="flex-1 truncate text-xs text-[var(--text)]">{title}</span>
        <div className="flex items-center gap-1">
          {painFlag && (
            <Icon name="painFlag" size="sm" className="text-rose-500" aria-label="Pain flagged" aria-hidden={false} />
          )}
          {coachAdvicePresent && (
            <Icon name="coachAdvice" size="sm" className="text-amber-600" aria-label="Has coach advice" aria-hidden={false} />
          )}
          {hasAthleteComment && (
            <Icon name="athleteComment" size="sm" className="text-blue-600" aria-label="Has athlete comment" aria-hidden={false} />
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
          className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg border border-white/40 bg-white/60 px-2 py-1 text-xs font-medium hover:bg-white/80"
          title="Quick mark reviewed"
        >
          <Icon name="reviewed" size="sm" />
        </button>
      )}
    </div>
  );
}
