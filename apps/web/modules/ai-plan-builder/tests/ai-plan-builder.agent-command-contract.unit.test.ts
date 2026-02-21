import { describe, expect, it } from 'vitest';

import { parseAgentAdjustRequest } from '@/modules/ai-plan-builder/server/agent-command';

describe('agent command contract', () => {
  it('accepts legacy instruction payloads', () => {
    const parsed = parseAgentAdjustRequest({
      draftPlanId: 'draft-1',
      scope: 'week',
      weekIndex: 3,
      instruction: 'Reduce intensity this week by 10%',
    });

    expect(parsed.scope).toBe('week');
    expect(parsed.weekIndex).toBe(3);
    expect(parsed.instruction).toContain('Reduce intensity');
    expect(parsed.command).toBeNull();
  });

  it('derives instruction from structured set-scope rewrite command', () => {
    const parsed = parseAgentAdjustRequest({
      draftPlanId: 'draft-1',
      command: {
        scope: 'set',
        commandType: 'REWRITE_SESSION_DETAIL',
        payload: {
          sessionId: 'sess-2',
          setType: 'main',
          text: '4 x 5 min @ threshold (2 min easy)',
          durationMinutes: 52,
        },
      },
    });

    expect(parsed.scope).toBe('set');
    expect(parsed.sessionId).toBe('sess-2');
    expect(parsed.instruction).toContain('main: 4 x 5 min @ threshold');
    expect(parsed.instruction).toContain('duration: 52 min');
  });

  it('requires session id for session/set scope', () => {
    expect(() =>
      parseAgentAdjustRequest({
        draftPlanId: 'draft-1',
        command: {
          scope: 'set',
          commandType: 'REWRITE_SESSION_DETAIL',
          payload: { setType: 'warmup', text: '10 min easy jog' },
        },
      })
    ).toThrowError(/sessionId is required/);
  });

  it('builds constraint adaptation instruction from structured command payload', () => {
    const parsed = parseAgentAdjustRequest({
      draftPlanId: 'draft-1',
      command: {
        scope: 'plan',
        commandType: 'ADAPT_FOR_CONSTRAINT',
        payload: {
          constraint: 'Travel Tue-Thu for next 2 weeks',
          guidance: 'Protect key weekend long session',
        },
      },
    });

    expect(parsed.scope).toBe('plan');
    expect(parsed.instruction).toContain('Travel Tue-Thu');
    expect(parsed.instruction).toContain('Protect key weekend long session');
  });
});
