import { z } from 'zod';

import { prisma } from '@/lib/prisma';

import {
  listPlanningPolicyProfiles,
  type PlanningPolicyProfileId,
  type PlanningPolicyProfileOverride,
  type PlanningPolicyProfileOverrideMap,
  setPlanningPolicyRuntimeOverrides,
} from '../rules/policy-registry';

const profileIdSchema = z.enum(['coachkit-conservative-v1', 'coachkit-safe-v1', 'coachkit-performance-v1']);

const weekBandOverrideSchema = z
  .object({
    baseMinRatio: z.number().min(0.2).max(1.5).optional(),
    baseMaxRatio: z.number().min(0.6).max(1.8).optional(),
    constrainedMinRatio: z.number().min(0.2).max(1.5).optional(),
    constrainedMaxRatio: z.number().min(0.6).max(1.8).optional(),
    beginnerEarlyMinRatio: z.number().min(0.2).max(1.5).optional(),
    beginnerEarlyMaxRatio: z.number().min(0.6).max(1.8).optional(),
    severeMinRatio: z.number().min(0.15).max(1.2).optional(),
    severeMaxRatio: z.number().min(0.8).max(2).optional(),
  })
  .strict()
  .optional();

const profileOverrideSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(240).optional(),
    maxIntensityDaysHardCap: z.number().int().min(1).max(3).optional(),
    maxDoublesHardCap: z.number().int().min(0).max(3).optional(),
    defaultRecoveryEveryNWeeks: z.number().int().min(2).max(8).optional(),
    defaultRecoveryWeekMultiplier: z.number().min(0.55).max(0.98).optional(),
    weekMinuteBands: weekBandOverrideSchema,
  })
  .strict();

export const policyTuningUpsertSchema = z.object({
  profileId: profileIdSchema,
  override: profileOverrideSchema,
});

async function ensurePolicyTuningTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS apb_policy_tuning (
      profile_id TEXT PRIMARY KEY,
      profile_version TEXT NOT NULL DEFAULT 'v1',
      override_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by_user_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

type PolicyRow = {
  profile_id: string;
  profile_version: string;
  override_json: unknown;
  updated_by_user_id: string | null;
  updated_at: Date;
};

export async function getPolicyTuningOverrideMap(): Promise<PlanningPolicyProfileOverrideMap> {
  await ensurePolicyTuningTable();
  const rows = await prisma.$queryRawUnsafe<PolicyRow[]>(`
    SELECT profile_id, profile_version, override_json, updated_by_user_id, updated_at
    FROM apb_policy_tuning
  `);

  const map: PlanningPolicyProfileOverrideMap = {};
  for (const row of rows) {
    const parsedId = profileIdSchema.safeParse(String(row.profile_id));
    if (!parsedId.success) continue;
    const parsedOverride = profileOverrideSchema.safeParse(row.override_json ?? {});
    if (!parsedOverride.success) continue;
    map[parsedId.data] = parsedOverride.data as PlanningPolicyProfileOverride;
  }
  return map;
}

export async function refreshPolicyRuntimeOverridesFromDb() {
  const overrides = await getPolicyTuningOverrideMap();
  setPlanningPolicyRuntimeOverrides(overrides);
  return overrides;
}

export async function listPolicyTuningForAdmin() {
  const [defaults, overrides] = await Promise.all([Promise.resolve(listPlanningPolicyProfiles()), getPolicyTuningOverrideMap()]);
  return defaults.map((profile) => ({
    profileId: profile.id,
    profileVersion: profile.version,
    label: profile.label,
    description: profile.description,
    effective: profile,
    override: overrides[profile.id] ?? null,
  }));
}

export async function upsertPolicyTuning(params: {
  profileId: PlanningPolicyProfileId;
  override: PlanningPolicyProfileOverride;
  actorUserId: string;
}) {
  await ensurePolicyTuningTable();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO apb_policy_tuning (profile_id, profile_version, override_json, updated_by_user_id, updated_at)
      VALUES ($1, 'v1', $2::jsonb, $3, NOW())
      ON CONFLICT (profile_id)
      DO UPDATE SET
        override_json = EXCLUDED.override_json,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = NOW()
    `,
    params.profileId,
    JSON.stringify(params.override ?? {}),
    params.actorUserId
  );

  return refreshPolicyRuntimeOverridesFromDb();
}

