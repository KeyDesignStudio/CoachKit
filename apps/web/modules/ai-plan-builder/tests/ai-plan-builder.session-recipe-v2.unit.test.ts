import { describe, expect, it } from 'vitest';

import { buildDeterministicSessionDetailV1, sessionDetailV1Schema } from '@/modules/ai-plan-builder/rules/session-detail';
import { sessionRecipeV2Schema } from '@/modules/ai-plan-builder/rules/session-recipe';

describe('ai-plan-builder session recipe v2', () => {
  it('emits recipeV2 for deterministic detail output', () => {
    const detail = buildDeterministicSessionDetailV1({
      discipline: 'bike',
      type: 'tempo',
      durationMinutes: 60,
      context: { equipment: 'trainer', fatigueState: 'normal' },
    });

    const parsed = sessionDetailV1Schema.safeParse(detail);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.recipeV2).toBeTruthy();
    const recipeParsed = sessionRecipeV2Schema.safeParse(parsed.data.recipeV2);
    expect(recipeParsed.success).toBe(true);
    if (!recipeParsed.success) return;

    expect(recipeParsed.data.version).toBe('v2');
    expect(recipeParsed.data.executionSummary.toLowerCase()).toContain('primary purpose');
    expect(recipeParsed.data.adjustments.ifMissed.length).toBeGreaterThan(0);
    expect(recipeParsed.data.adjustments.ifCooked.length).toBeGreaterThan(0);
    expect(recipeParsed.data.blocks.some((b) => b.key === 'main' || b.key === 'strength')).toBe(true);
  });

  it('sets expected primary goal for threshold sessions', () => {
    const detail = buildDeterministicSessionDetailV1({
      discipline: 'run',
      type: 'threshold',
      durationMinutes: 50,
    });
    const recipe = (detail as any).recipeV2;
    const parsed = sessionRecipeV2Schema.safeParse(recipe);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.primaryGoal).toBe('threshold-development');
  });

  it('downgrades threshold to recovery when fatigue state is cooked', () => {
    const detail = buildDeterministicSessionDetailV1({
      discipline: 'run',
      type: 'threshold',
      durationMinutes: 50,
      context: { fatigueState: 'cooked' },
    });
    const recipe = (detail as any).recipeV2;
    const parsed = sessionRecipeV2Schema.safeParse(recipe);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.primaryGoal).toBe('recovery-absorption');
  });

  it('caps generated detail duration to available time when smaller than planned', () => {
    const detail = buildDeterministicSessionDetailV1({
      discipline: 'bike',
      type: 'endurance',
      durationMinutes: 90,
      context: { availableTimeMinutes: 45 },
    });
    const parsed = sessionDetailV1Schema.safeParse(detail);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const total = parsed.data.structure.reduce((sum, block) => sum + (block.durationMinutes ?? 0), 0);
    expect(total).toBeLessThanOrEqual(45);
  });
});
