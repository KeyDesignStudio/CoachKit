import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeStableSha256 } from '@/modules/ai-plan-builder/rules/stable-hash';
import { DeterministicAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/deterministic';
import { getAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/factory';
import { draftPlanSetupV1Schema } from '@/modules/ai-plan-builder/server/draft-plan';

type Json = unknown;

function readFixtureJson(filename: string): Json {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.resolve(here, '../evals/fixtures');
  const raw = readFileSync(path.join(fixturesDir, filename), 'utf8');
  return JSON.parse(raw);
}

const coachIntentSchema = z
  .object({
    note: z.string().optional(),
    goalTag: z.enum(['base', 'build', 'peak', 'recover']).optional(),
  })
  .strict();

const intakeSchema = z
  .object({
    evidence: z.array(
      z
        .object({
          questionKey: z.string().min(1),
          answerJson: z.unknown(),
        })
        .strict()
    ),
    coachIntent: coachIntentSchema.optional(),
  })
  .strict();

const draftPlanInputSchema = z
  .object({
    setup: draftPlanSetupV1Schema,
    coachIntent: coachIntentSchema.optional(),
  })
  .strict();

const proposalDiffsInputSchema = z
  .object({
    triggerTypes: z.array(z.enum(['SORENESS', 'TOO_HARD', 'MISSED_KEY', 'LOW_COMPLIANCE', 'HIGH_COMPLIANCE'])),
    draft: z
      .object({
        weeks: z.array(z.object({ weekIndex: z.number().int().min(0), locked: z.boolean() })),
        sessions: z.array(
          z.object({
            id: z.string().min(1),
            weekIndex: z.number().int().min(0),
            ordinal: z.number().int().min(0),
            dayOfWeek: z.number().int().min(0).max(6),
            type: z.string().min(1),
            durationMinutes: z.number().int().min(0),
            notes: z.string().nullable(),
            locked: z.boolean(),
          })
        ),
      })
      .strict(),
    coachIntent: coachIntentSchema.optional(),
  })
  .strict();

describe('AI Plan Builder v1 (Tranche 11B: eval fixtures)', () => {
  it('fixtures validate and have stable hashes', () => {
    const intakeMinimal = intakeSchema.parse(readFixtureJson('intake-minimal.json'));
    const intakeMedium = intakeSchema.parse(readFixtureJson('intake-medium.json'));
    const coachIntent = coachIntentSchema.parse(readFixtureJson('coach-intent.json'));
    const draftSetup = draftPlanInputSchema.parse(readFixtureJson('draft-plan-setup-small.json'));
    const proposalDiffs = proposalDiffsInputSchema.parse(readFixtureJson('proposal-diffs-input.json'));

    expect(computeStableSha256(intakeMinimal)).toMatchInlineSnapshot(`"d93b27de59e594acd9232ee731d6d1a0f1645c99200f32cce8e2f872d46e2d0a"`);
    expect(computeStableSha256(intakeMedium)).toMatchInlineSnapshot(`"718438e183f9f0a06949779abcb21f954476fc77fb6447e1699f3f73c6ce1c59"`);
    expect(computeStableSha256(coachIntent)).toMatchInlineSnapshot(`"586be62bdfac809b73052e9fc739ab1a84a0298e476fc8f23653d743495a531c"`);
    expect(computeStableSha256(draftSetup)).toMatchInlineSnapshot(`"f2ac2e03ba176d9260a3f3367454b5fa66854601eb254c36ab5cb0e32d5f6bc3"`);
    expect(computeStableSha256(proposalDiffs)).toMatchInlineSnapshot(`"8e878ee95bf5266074a7f5839f7e7dd20e42bdfab439a4a0b8e54201f3f1bb91"`);
  });

  it('deterministic outputs stay stable on fixtures', async () => {
    const ai = new DeterministicAiPlanBuilderAI({ recordAudit: false });

    const intakeMinimal = intakeSchema.parse(readFixtureJson('intake-minimal.json'));
    const draftSetup = draftPlanInputSchema.parse(readFixtureJson('draft-plan-setup-small.json'));
    const proposalDiffs = proposalDiffsInputSchema.parse(readFixtureJson('proposal-diffs-input.json'));

    const intakeOut = await ai.summarizeIntake(intakeMinimal as any);
    const draftOut = await ai.suggestDraftPlan(draftSetup as any);
    const diffsOut = await ai.suggestProposalDiffs(proposalDiffs as any);

    expect(computeStableSha256(intakeOut)).toMatchInlineSnapshot(`"25773d85f0a6230e35b4fd95bb975ee8023a19b93d2483766c45a5db050e8bfe"`);
    expect(computeStableSha256(draftOut)).toMatchInlineSnapshot(`"11fd4b7f8ef2a12eaf11b1941e3784b02761473064e6be44a1a68afb8b9bef58"`);
    expect(computeStableSha256(diffsOut)).toMatchInlineSnapshot(`"1f0c88a58040d2742b66f59d0fef6564ba2dced176671933e72f4d3ce0980223"`);
  });

  it('fixtures are compatible with mock-LLM mode', async () => {
    const prev = {
      AI_PLAN_BUILDER_AI_MODE: process.env.AI_PLAN_BUILDER_AI_MODE,
      AI_PLAN_BUILDER_LLM_PROVIDER: process.env.AI_PLAN_BUILDER_LLM_PROVIDER,
      AI_PLAN_BUILDER_LLM_MODEL: process.env.AI_PLAN_BUILDER_LLM_MODEL,
    };

    try {
      process.env.AI_PLAN_BUILDER_AI_MODE = 'llm';
      process.env.AI_PLAN_BUILDER_LLM_PROVIDER = 'mock';
      process.env.AI_PLAN_BUILDER_LLM_MODEL = 'mock';

      const ai = getAiPlanBuilderAI();
      const input = intakeSchema.parse(readFixtureJson('intake-minimal.json'));

      const out = await ai.summarizeIntake(input as any);
      expect(computeStableSha256(out)).toMatchInlineSnapshot(`"25773d85f0a6230e35b4fd95bb975ee8023a19b93d2483766c45a5db050e8bfe"`);
    } finally {
      process.env.AI_PLAN_BUILDER_AI_MODE = prev.AI_PLAN_BUILDER_AI_MODE;
      process.env.AI_PLAN_BUILDER_LLM_PROVIDER = prev.AI_PLAN_BUILDER_LLM_PROVIDER;
      process.env.AI_PLAN_BUILDER_LLM_MODEL = prev.AI_PLAN_BUILDER_LLM_MODEL;
    }
  });
});
