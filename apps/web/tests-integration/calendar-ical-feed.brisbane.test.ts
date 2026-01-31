import { describe, expect, it } from 'vitest';

import { buildIcsCalendar } from '@/lib/ical';
import { buildIcalEventsForCalendarItems, filterCalendarItemsForLocalDayRange } from '@/lib/calendar-ical-feed';

describe('calendar iCal feed local-day selection (Australia/Brisbane)', () => {
  it('includes an event at 2026-01-29T17:00Z when requesting local day 2026-01-30', () => {
    const timeZone = 'Australia/Brisbane';

    const items = [
      {
        id: 'item-in-range',
        // date-only UTC day key for the instant 2026-01-29T17:00Z
        date: new Date('2026-01-29T00:00:00.000Z'),
        plannedStartTimeLocal: '17:00',
        status: 'PLANNED',
        discipline: 'RUN',
        title: 'Morning run',
        workoutDetail: null,
        plannedDurationMinutes: 60,
        completedActivities: [],
      },
      {
        id: 'item-out-of-range',
        date: new Date('2026-01-30T00:00:00.000Z'),
        plannedStartTimeLocal: '15:00',
        status: 'PLANNED',
        discipline: 'RUN',
        title: 'Other run',
        workoutDetail: null,
        plannedDurationMinutes: 60,
        completedActivities: [],
      },
    ];

    const filtered = filterCalendarItemsForLocalDayRange({
      items,
      fromDayKey: '2026-01-30',
      toDayKey: '2026-01-30',
      timeZone,
    });

    expect(filtered.map((i) => i.id)).toEqual(['item-in-range']);

    const events = buildIcalEventsForCalendarItems({
      items: filtered,
      timeZone,
      baseUrl: 'https://example.com',
    });

    const ics = buildIcsCalendar({
      timeZone,
      calName: 'CoachKit Workouts',
      nowUtc: new Date('2026-01-31T00:00:00.000Z'),
      events,
    });

    expect(ics).toContain('UID:coachkit-item-in-range@coachkit');
    expect(ics).toContain('DTSTART:20260129T170000Z');
    expect(ics).toContain('DTEND:20260129T180000Z');

    // Ensure the out-of-range item is not present.
    expect(ics).not.toContain('UID:coachkit-item-out-of-range@coachkit');
  });
});
