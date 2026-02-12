const MARKS = {
  shell: 'calendar_shell_paint',
  data: 'calendar_data_ready',
  grid: 'calendar_grid_interactive',
} as const;

type CalendarPerfMark = keyof typeof MARKS;

type LogState = {
  current: boolean;
};

function isProd() {
  return process.env.NODE_ENV === 'production';
}

export function resetCalendarPerfMarks() {
  if (isProd()) return;
  try {
    Object.values(MARKS).forEach((mark) => performance.clearMarks(mark));
  } catch {
    // noop
  }
}

export function markCalendarPerf(mark: CalendarPerfMark) {
  if (isProd()) return;
  try {
    performance.mark(MARKS[mark]);
  } catch {
    // noop
  }
}

export function logCalendarPerfOnce(label: string, loggedRef: LogState) {
  if (isProd() || loggedRef.current) return;

  try {
    const shell = performance.getEntriesByName(MARKS.shell).slice(-1)[0];
    const data = performance.getEntriesByName(MARKS.data).slice(-1)[0];
    const grid = performance.getEntriesByName(MARKS.grid).slice(-1)[0];

    if (!shell || !data || !grid) return;

    loggedRef.current = true;

    const shellToData = Math.round(data.startTime - shell.startTime);
    const shellToGrid = Math.round(grid.startTime - shell.startTime);
    const dataToGrid = Math.round(grid.startTime - data.startTime);

    // eslint-disable-next-line no-console
    console.debug(
      `[perf] ${label} shell->data ${shellToData}ms; shell->grid ${shellToGrid}ms; data->grid ${dataToGrid}ms`
    );
  } catch {
    // noop
  }
}
