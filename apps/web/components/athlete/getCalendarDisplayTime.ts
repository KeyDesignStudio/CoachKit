// Compatibility bridge: athlete calendar and coach calendar must share the exact same display-time logic.
// TODO(remove-after-import-cleanup): migrate imports to '@/components/calendar/getCalendarDisplayTime'.
export { getCalendarDisplayTime, getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
