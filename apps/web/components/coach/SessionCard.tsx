import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';

const WEEKDAY_OPTIONS = [
  { label: 'Mon', value: 'MO' },
  { label: 'Tue', value: 'TU' },
  { label: 'Wed', value: 'WE' },
  { label: 'Thu', value: 'TH' },
  { label: 'Fri', value: 'FR' },
  { label: 'Sat', value: 'SA' },
  { label: 'Sun', value: 'SU' },
];

const DAY_ORDER = WEEKDAY_OPTIONS.map((option) => option.value);
const DAY_LABEL: Record<string, string> = WEEKDAY_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.value]: option.label }),
  {}
);

type GroupVisibility = 'ALL' | 'SQUAD' | 'SELECTED';

type GroupSessionTarget = {
  id: string;
  athleteId: string | null;
  squadId: string | null;
  athlete?: {
    user: {
      id: string;
      name: string | null;
    } | null;
  } | null;
  squad?: {
    id: string;
    name: string;
  } | null;
};

type GroupSessionRecord = {
  id: string;
  title: string;
  discipline: string;
  location: string | null;
  startTimeLocal: string;
  durationMinutes: number;
  description: string | null;
  recurrenceRule: string;
  visibilityType: GroupVisibility;
  optionalFlag: boolean;
  targets: GroupSessionTarget[];
};

type SessionCardProps = {
  session: GroupSessionRecord;
  onClick: () => void;
};

function parseRuleDays(rule: string): string[] {
  if (!rule) return [];
  const parts = rule.split(';');
  const byDay = parts
    .map((part) => part.trim())
    .map((part) => part.split('='))
    .find(([key]) => key?.toUpperCase() === 'BYDAY');
  if (!byDay || !byDay[1]) return [];
  return byDay[1]
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => DAY_ORDER.includes(token));
}

function describeRecurrence(rule: string): string {
  const days = parseRuleDays(rule);
  if (!days.length) return 'Weekly';
  const labels = days.map((day) => DAY_LABEL[day] ?? day);
  return labels.join(', ');
}

function formatTargets(session: GroupSessionRecord): string {
  if (session.visibilityType === 'ALL') return 'All athletes';
  if (session.visibilityType === 'SELECTED') {
    const count = session.targets.filter((t) => t.athleteId).length;
    return `${count} athlete${count !== 1 ? 's' : ''}`;
  }
  const count = session.targets.filter((t) => t.squadId).length;
  return `${count} squad${count !== 1 ? 's' : ''}`;
}

export function SessionCard({ session, onClick }: SessionCardProps) {
  const theme = getDisciplineTheme(session.discipline);

  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border border-white/30 bg-white/60 p-4 text-left shadow-sm backdrop-blur-xl transition-all hover:border-white/50 hover:bg-white/70 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        {/* Discipline Icon */}
        <Icon name={theme.iconName} size="md" className={`${theme.textClass} flex-shrink-0 mt-0.5`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-[var(--text)] truncate">{session.title}</h3>
            <Icon name="next" size="sm" className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--muted)]" />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <span className={`font-semibold ${theme.textClass}`}>{session.discipline}</span>
            <span>{describeRecurrence(session.recurrenceRule)}</span>
            <span>{session.startTimeLocal}</span>
            <span>{session.durationMinutes} min</span>
            <span>{formatTargets(session)}</span>
            {session.optionalFlag && <span className="text-amber-600">Optional</span>}
          </div>

          {session.location && (
            <p className="mt-1 text-xs text-[var(--muted)] truncate">
              <Icon name="info" size="sm" className="inline mr-1" />
              {session.location}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
