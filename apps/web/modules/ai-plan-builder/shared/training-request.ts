const HOURS_MS = 60 * 60 * 1000;

export const TRAINING_REQUEST_INIT_PREFIX = 'Training Request: Please complete your form so I can build your next training block.';
export const TRAINING_REQUEST_REMINDER_PREFIX = 'Reminder: your Training Request is still pending.';
export const TRAINING_REQUEST_FIRST_REMINDER_HOURS = 24;
export const TRAINING_REQUEST_REPEAT_REMINDER_HOURS = 72;
export const ATHLETE_TRAINING_REQUEST_PATH = '/athlete/intake';

function normalizeIntakeUrl(intakeUrl?: string): string {
  const trimmed = String(intakeUrl ?? '').trim();
  return trimmed || ATHLETE_TRAINING_REQUEST_PATH;
}

export function buildTrainingRequestStartMessage(intakeUrl?: string): string {
  return `${TRAINING_REQUEST_INIT_PREFIX}\nOpen here: ${normalizeIntakeUrl(intakeUrl)}`;
}

export function buildTrainingRequestReminderMessage(intakeUrl?: string): string {
  return `${TRAINING_REQUEST_REMINDER_PREFIX} Please complete it now so I can finalize your upcoming plan.\nOpen here: ${normalizeIntakeUrl(intakeUrl)}`;
}

export function isTrainingRequestStartMessage(body: string): boolean {
  return String(body ?? '').trim().startsWith(TRAINING_REQUEST_INIT_PREFIX);
}

export function isTrainingRequestReminderMessage(body: string): boolean {
  return String(body ?? '').trim().startsWith(TRAINING_REQUEST_REMINDER_PREFIX);
}

export function computeTrainingRequestNextReminderDueAt(params: { requestedAt: Date; lastReminderAt?: Date | null }): Date {
  const baseline = params.lastReminderAt ?? params.requestedAt;
  const delayHours = params.lastReminderAt ? TRAINING_REQUEST_REPEAT_REMINDER_HOURS : TRAINING_REQUEST_FIRST_REMINDER_HOURS;
  return new Date(baseline.getTime() + delayHours * HOURS_MS);
}
