import { describe, expect, it } from 'vitest';
import { deriveAdaptationTriggersFromSignals } from '@/modules/ai-plan-builder/server/adaptations';

function makeSession(overrides?: Partial<{
  id: string;
  weekIndex: number;
  dayOfWeek: number;
  type: string;
  durationMinutes: number;
  notes: string | null;
}>) {
  return {
    id: overrides?.id ?? 's1',
    weekIndex: overrides?.weekIndex ?? 0,
    dayOfWeek: overrides?.dayOfWeek ?? 2,
    type: overrides?.type ?? 'endurance',
    durationMinutes: overrides?.durationMinutes ?? 45,
    notes: overrides?.notes ?? null,
  };
}

function makeFeedback(overrides?: Partial<{
  id: string;
  createdAt: Date;
  completedStatus: string;
  feel: string | null;
  sorenessFlag: boolean;
  sorenessNotes: string | null;
  rpe: number | null;
  sleepQuality: number | null;
  sessionId: string;
  session: ReturnType<typeof makeSession>;
}>) {
  return {
    id: overrides?.id ?? 'fb1',
    createdAt: overrides?.createdAt ?? new Date('2026-02-20T10:00:00.000Z'),
    completedStatus: overrides?.completedStatus ?? 'DONE',
    feel: overrides?.feel ?? 'OK',
    sorenessFlag: overrides?.sorenessFlag ?? false,
    sorenessNotes: overrides?.sorenessNotes ?? null,
    rpe: overrides?.rpe ?? 5,
    sleepQuality: overrides?.sleepQuality ?? 3,
    sessionId: overrides?.sessionId ?? 's1',
    session: overrides?.session ?? makeSession(),
  };
}

describe('adaptation signals derivation', () => {
  it('emits SORENESS when pain flag exists without soreness feedback', () => {
    const now = new Date('2026-02-21T12:00:00.000Z');
    const triggers = deriveAdaptationTriggersFromSignals({
      now,
      windowDays: 10,
      feedback: [makeFeedback()],
      completedActivities: [
        { id: 'ca1', startTime: new Date('2026-02-20T09:00:00.000Z'), rpe: 6, painFlag: true },
      ],
    });

    const types = new Set(triggers.map((t) => t.triggerType));
    expect(types.has('SORENESS')).toBe(true);
  });

  it('emits TOO_HARD from high-RPE cluster even without repeated TOO_HARD feel', () => {
    const now = new Date('2026-02-21T12:00:00.000Z');
    const triggers = deriveAdaptationTriggersFromSignals({
      now,
      windowDays: 10,
      feedback: [
        makeFeedback({ id: 'fb1', rpe: 8, feel: 'OK' }),
        makeFeedback({ id: 'fb2', createdAt: new Date('2026-02-19T10:00:00.000Z'), rpe: 9, feel: 'OK' }),
      ],
      completedActivities: [
        { id: 'ca1', startTime: new Date('2026-02-18T09:00:00.000Z'), rpe: 8, painFlag: false },
      ],
    });

    const types = new Set(triggers.map((t) => t.triggerType));
    expect(types.has('TOO_HARD')).toBe(true);
  });

  it('requires stronger sample before HIGH_COMPLIANCE', () => {
    const now = new Date('2026-02-21T12:00:00.000Z');
    const lowSample = deriveAdaptationTriggersFromSignals({
      now,
      windowDays: 10,
      feedback: [
        makeFeedback({ id: 'fb1', completedStatus: 'DONE', rpe: 5 }),
        makeFeedback({ id: 'fb2', completedStatus: 'DONE', rpe: 6, createdAt: new Date('2026-02-20T11:00:00.000Z') }),
      ],
      completedActivities: [],
    });
    expect(lowSample.some((t) => t.triggerType === 'HIGH_COMPLIANCE')).toBe(false);

    const adequateSample = deriveAdaptationTriggersFromSignals({
      now,
      windowDays: 10,
      feedback: [
        makeFeedback({ id: 'fb1', completedStatus: 'DONE', rpe: 5 }),
        makeFeedback({ id: 'fb2', completedStatus: 'DONE', rpe: 5, createdAt: new Date('2026-02-20T11:00:00.000Z') }),
        makeFeedback({ id: 'fb3', completedStatus: 'PARTIAL', rpe: 6, createdAt: new Date('2026-02-19T11:00:00.000Z') }),
        makeFeedback({ id: 'fb4', completedStatus: 'DONE', rpe: 6, createdAt: new Date('2026-02-18T11:00:00.000Z') }),
      ],
      completedActivities: [],
    });
    expect(adequateSample.some((t) => t.triggerType === 'HIGH_COMPLIANCE')).toBe(true);
  });

  it('emits MISSED_KEY on high missed-key rate with sufficient key opportunities', () => {
    const now = new Date('2026-02-21T12:00:00.000Z');
    const keySession = makeSession({ type: 'tempo', durationMinutes: 55 });
    const triggers = deriveAdaptationTriggersFromSignals({
      now,
      windowDays: 10,
      feedback: [
        makeFeedback({ id: 'fb1', session: keySession, completedStatus: 'SKIPPED' }),
        makeFeedback({ id: 'fb2', session: keySession, completedStatus: 'SKIPPED', createdAt: new Date('2026-02-20T10:00:00.000Z') }),
        makeFeedback({ id: 'fb3', session: keySession, completedStatus: 'DONE', createdAt: new Date('2026-02-19T10:00:00.000Z') }),
      ],
      completedActivities: [],
    });

    expect(triggers.some((t) => t.triggerType === 'MISSED_KEY')).toBe(true);
  });
});
