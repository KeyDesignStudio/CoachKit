import { BlockTitle } from '@/components/ui/BlockTitle';
import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { TrendDelta } from '@/components/dashboard/TrendDelta';
import { tokens } from '@/components/ui/tokens';
import { cn } from '@/lib/cn';

type AtAGlanceStatRow = {
  label: string;
  value: string;
  deltaPercent?: number | null;
};

type AtAGlanceDisciplineRow = {
  discipline: string;
  totalMinutes: number;
  rightValue: string;
};

type AtAGlanceCardProps = {
  statsRows: AtAGlanceStatRow[];
  disciplineRows: AtAGlanceDisciplineRow[];
  loading?: boolean;
  minHeightPx?: number;
  testIds: {
    card: string;
    grid: string;
    stats: string;
    statRow: string;
    disciplineLoad: string;
  };
};

export function AtAGlanceCard({ statsRows, disciplineRows, loading = false, minHeightPx, testIds }: AtAGlanceCardProps) {
  const maxMinutes = Math.max(1, ...disciplineRows.map((row) => row.totalMinutes));

  return (
    <div
      className={cn('rounded-2xl bg-[var(--bg-card)] min-h-0 h-full flex flex-col', tokens.spacing.containerPadding)}
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
            'grid w-full grid-cols-1 items-start min-[520px]:grid-cols-[minmax(0,8fr)_minmax(0,9fr)] min-[520px]:items-center min-w-0',
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
                    'min-w-0 flex flex-col items-start justify-between gap-1 md:flex-row md:items-baseline',
                    tokens.spacing.elementPadding,
                    tokens.spacing.widgetGap,
                    idx < statsRows.length - 1 ? 'border-b border-[var(--border-subtle)]' : ''
                  )}
                  data-testid={testIds.statRow}
                >
                  <div className={cn('min-w-0 whitespace-normal uppercase tracking-wide leading-4 md:leading-none', tokens.typography.meta)} title={row.label}>
                    {row.label}
                  </div>
                  <div className="w-full text-left md:w-auto md:text-right flex-shrink-0">
                    <div className={cn('leading-[1.2] tabular-nums text-sm font-semibold text-[var(--text)]')}>{row.value}</div>
                    {row.deltaPercent !== undefined ? (
                      <TrendDelta delta={row.deltaPercent} className="mt-0.5 inline-flex tabular-nums" />
                    ) : null}
                  </div>
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
                  <div key={row.discipline} className="grid min-w-0 grid-cols-[auto,minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                    <div className={cn('flex items-center min-w-[64px]', tokens.spacing.widgetGap)}>
                      <Icon name={theme.iconName} size="sm" className={theme.textClass} aria-hidden />
                      <span className={cn('font-medium text-[var(--text)]', tokens.typography.meta)}>
                        {(row.discipline || 'OTHER').toUpperCase()}
                      </span>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                      <div
                        className="h-2.5 min-w-[72px] flex-1 basis-[88px] overflow-hidden rounded-full bg-[var(--bar-track)]"
                        data-testid={`${testIds.disciplineLoad}-row-bar`}
                      >
                        <div className="h-full rounded-full bg-[var(--bar-fill)]" style={{ width: `${Math.round(pct * 100)}%` }} />
                      </div>

                      <div
                        className={cn('ml-auto tabular-nums whitespace-nowrap text-right text-[11px] text-[var(--muted)] sm:text-xs')}
                        title={row.rightValue}
                        data-testid={`${testIds.disciplineLoad}-row-value`}
                      >
                        {row.rightValue}
                      </div>
                    </div>
                  </div>
                );
              })}
              {loading ? (
                <div className="text-sm text-[var(--muted)] px-1 py-2">Loading data...</div>
              ) : disciplineRows.length === 0 ? (
                <div className="text-sm text-[var(--muted)] px-1 py-2">No data for this range.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
