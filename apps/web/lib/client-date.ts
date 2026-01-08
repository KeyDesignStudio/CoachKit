export function startOfWeek(date = new Date()): Date {
  const clone = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = clone.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  clone.setUTCDate(clone.getUTCDate() - diffToMonday);
  return clone;
}

export function addDays(date: Date, days: number): Date {
  const clone = new Date(date);
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDisplay(dateIso: string): string {
  const date = new Date(dateIso);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
