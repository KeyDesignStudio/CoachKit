import { describe, expect, it } from 'vitest';

import { buildAiPlanBuilderSessionTitle } from '@/modules/ai-plan-builder/lib/session-title';

describe('AI Plan Builder v1 session titles', () => {
  it('uses canonical 2-word titles for known types', () => {
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'run', type: 'endurance' })).toBe('Endurance Run');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'bike', type: 'threshold' })).toBe('Threshold Ride');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'bike', type: 'tempo' })).toBe('Tempo Ride');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'swim', type: 'technique' })).toBe('Technique Swim');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'bike', type: 'recovery' })).toBe('Recovery Ride');
  });

  it('handles rest and strength compactly', () => {
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'rest', type: 'rest' })).toBe('Rest Day');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'strength', type: 'strength' })).toBe('Strength Training');
  });

  it('strips trailing session words for free-text types', () => {
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'run', type: 'Hill repeats session' })).toBe('Hill Repeats Run');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'run', type: 'tempo workout' })).toBe('Tempo Run');
  });

  it('does not double-suffix sport nouns when already present', () => {
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'run', type: 'Tempo Run' })).toBe('Tempo Run');
  });

  it('falls back to a stable planned title when type is empty', () => {
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'run', type: '' })).toBe('Planned Run');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'unknown', type: '' })).toBe('Planned Workout');
  });

  it('strips duration tokens from free-text types', () => {
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'run', type: 'Endurance (50 min)' })).toBe('Endurance Run');
    expect(buildAiPlanBuilderSessionTitle({ discipline: 'bike', type: 'Tempo 45 min' })).toBe('Tempo Ride');
  });
});
