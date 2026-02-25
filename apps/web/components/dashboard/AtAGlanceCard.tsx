import { BlockTitle } from '@/components/ui/BlockTitle';
import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';

type AtAGlanceStatRow = {
  label: string;
  value: string;
};

type AtAGlanceDisciplineRow = {
  discipline: string;
  totalMinutes: number;
  rightValue: string;
};

type AtAGlanceCardProps = {
  statsRows: AtAGlanceStatRow[];
  disciplineRows: AtAGlanceDisciplineRow[];
  minHeightPx?: number;
  testIds: {
    card: string;
    grid: string;
    stats: string;
    statRow: string;
    disciplineLoad: string;
  };
};

export function AtAGlanceCard({ statsRows, disciplineRows, minHeightPx, testIds }: AtAGlanceCardProps) {
  const maxMinutes = Math.max(1, ...disciplineRows.map((row) => row.totalMinutes));

  return (
    <div
      className={cn('rounded-2xl bg-[var(--bg-card)] min-h-0 flex flex-col', tokens.spacing.containerPadding)}
      style={minHeightPx ? { minHeight: `${minHeightPx}px` } : undefined}
      data-testid={testIds.card}
    >
      <div className="flex items-end justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Icon name="info" size="sm" className="text-[var(--muted)]" aria-hidden />
          <BlockTitle>At a glance</BlockTitle>
        </div>
      </div>

      <div className="flex flex-1 items-center">
        <div
          className={cn(
            'grid w-full grid-cols-1 items-start min-[520px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[520px]:items-center min-w-0',
            tokens.spacing.widgetGap
          )}
          data-testid={testIds.grid}
        >
          <div className={cn('min-w-0 rounded-2xl bg-[var(--bg-structure)]/40', tokens.spacing.elementPadding)} data-testid={testIds.stats}>
            <div className={cn('grid', tokens.spacing.widgetGap)}>
              {statsRows.map((row, idx) => (
                <div
                  key={row.label}
                  className={cn(
                    'min-w-0 flex items-baseline justify-between',
                    tokens.spacing.elementPadding,
                    tokens.spacing.widgetGap,
                    idx < statsRows.length - 1 ? 'border-b border-[var(--border-subtle)]' : ''
                  )}
                  data-testid={testIds.statRow}
                >
                  <div className={cn('min-w-0 uppercase tracking-wide truncate', tokens.typography.meta)} title={row.label}>
                    {row.label}
                  </div>
                  <div className={cn('flex-shrink-0 leading-[1.05] tabular-nums text-sm font-semibold text-[var(--text)]')}>{row.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={cn('min-w-0 rounded-2xl bg-[var(--bg-structure)]/40', tokens.spacing.elementPadding)} data-testid={testIds.disciplineLoad}>
            <div className={cn('flex flex-col', tokens.spacing.widgetGap)}>
              {disciplineRows.map((row) => {
                const theme = getDisciplineTheme(row.discipline);
                const pct = Math.max(0, Math.min(1, row.totalMinutes / maxMinutes));
                return (
                  <div key={row.discipline} className={cn('grid grid-cols-[auto,1fr,auto] items-center min-w-0', tokens.spacing.widgetGap)}>
                    <div className={cn('flex items-center min-w-[64px]', tokens.spacing.widgetGap)}>
                      <Icon name={theme.iconName} size="sm" className={theme.textClass} aria-hidden />
                      <span className={cn('font-medium text-[var(--text)]', tokens.typography.meta)}>
                        {(row.discipline || 'OTHER').toUpperCase()}
                      </span>
                    </div>

                    <div className="h-2 rounded-full bg-[var(--bar-track)] overflow-hidden">
                      <div className="h-full rounded-full bg-[var(--bar-fill)]" style={{ width: `${Math.round(pct * 100)}%` }} />
                    </div>

                    <div className={cn('tabular-nums text-right whitespace-nowrap truncate max-w-[120px]', tokens.typography.meta)} title={row.rightValue}>
                      {row.rightValue}
                    </div>
                  </div>
                );
              })}
              {disciplineRows.length === 0 ? <div className="text-sm text-[var(--muted)] px-1 py-2">No data for this range.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
