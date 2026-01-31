import { combineDateWithLocalTime } from '@/lib/date';
import { getUtcRangeForLocalDayKeyRange, isStoredStartInUtcRange } from '@/lib/calendar-local-day';

export type IcalFeedCalendarItem = {
  id: string;
  date: Date;
  plannedStartTimeLocal: string | null;
  status: string;
  discipline: string;
  title: string;
  workoutDetail: string | null;
  plannedDurationMinutes: number | null;
  completedActivities: Array<{
    startTime: Date;
    durationMinutes: number | null;
  }>;
};

const DEFAULT_DURATION_SEC = 60 * 60;

function isCompletedStatus(status: string): boolean {
  return status === 'COMPLETED_MANUAL' || status === 'COMPLETED_SYNCED' || status === 'COMPLETED_SYNCED_DRAFT';
}

export function getStoredStartUtcForCalendarItem(item: Pick<IcalFeedCalendarItem, 'date' | 'plannedStartTimeLocal'>): Date {
  return combineDateWithLocalTime(item.date, item.plannedStartTimeLocal);
}

export function filterCalendarItemsForLocalDayRange(params: {
  items: IcalFeedCalendarItem[];
  fromDayKey: string;
  toDayKey: string;
  timeZone: string;
  utcRange?: { startUtc: Date; endUtc: Date };
}): IcalFeedCalendarItem[] {
  const { items, fromDayKey, toDayKey, timeZone } = params;

  const utcRange =
    params.utcRange ??
    getUtcRangeForLocalDayKeyRange({
      fromDayKey,
      toDayKey,
      timeZone,
    });

  return items
    .map((item) => ({ item, storedStartUtc: getStoredStartUtcForCalendarItem(item) }))
    .filter(({ storedStartUtc }) => isStoredStartInUtcRange(storedStartUtc, utcRange))
    .sort((a, b) => a.storedStartUtc.getTime() - b.storedStartUtc.getTime())
    .map(({ item }) => item);
}

export function buildIcalEventsForCalendarItems(params: {
  items: IcalFeedCalendarItem[];
  timeZone: string;
  baseUrl: string;
}): Array<{
  uid: string;
  dtStartUtc: Date;
  dtEndUtc: Date;
  summary: string;
  description: string;
}> {
  const { items, baseUrl } = params;

  return items.map((item) => {
    const latest = item.completedActivities[0] ?? null;
    const isCompleted = isCompletedStatus(item.status);

    const plannedStartUtc = getStoredStartUtcForCalendarItem(item);
    const startUtc = isCompleted && latest?.startTime ? new Date(latest.startTime) : plannedStartUtc;

    const durationSec =
      (isCompleted && latest?.durationMinutes ? latest.durationMinutes * 60 : null) ??
      (item.plannedDurationMinutes ? item.plannedDurationMinutes * 60 : null) ??
      DEFAULT_DURATION_SEC;

    const endUtc = new Date(startUtc.getTime() + durationSec * 1000);

    const statusLabel =
      item.status === 'SKIPPED'
        ? 'MISSED'
        : isCompleted
          ? 'COMPLETED'
          : item.status === 'MODIFIED'
            ? 'PLANNED'
            : 'PLANNED';

    const detail = item.workoutDetail?.trim() || '';
    const url = `${baseUrl}/athlete/workouts/${item.id}`;

    const descriptionLines = [`Status: ${statusLabel}`];
    if (detail) descriptionLines.push('', detail);
    descriptionLines.push('', url);

    return {
      uid: `coachkit-${item.id}@coachkit`,
      dtStartUtc: startUtc,
      dtEndUtc: endUtc,
      summary: `${item.discipline} — ${item.title}`,
      description: descriptionLines.join('\n'),
    };
  });
}
