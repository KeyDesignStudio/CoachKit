import type { DraftPlanSetupV1 } from './draft-generator';

export type PlanningPolicyProfileId =
  | 'coachkit-conservative-v1'
  | 'coachkit-safe-v1'
  | 'coachkit-performance-v1';

export type PlanningPolicyProfile = {
  id: PlanningPolicyProfileId;
  version: 'v1';
  label: string;
  description: string;
  maxIntensityDaysHardCap: number;
  maxDoublesHardCap: number;
  defaultRecoveryEveryNWeeks: number;
  defaultRecoveryWeekMultiplier: number;
  weekMinuteBands: {
    baseMinRatio: number;
    baseMaxRatio: number;
    constrainedMinRatio: number;
    constrainedMaxRatio: number;
    beginnerEarlyMinRatio: number;
    beginnerEarlyMaxRatio: number;
    severeMinRatio: number;
    severeMaxRatio: number;
  };
};

const PROFILES: Record<PlanningPolicyProfileId, PlanningPolicyProfile> = {
  'coachkit-conservative-v1': {
    id: 'coachkit-conservative-v1',
    version: 'v1',
    label: 'Conservative',
    description: 'Strong safety bias. Slower progression and tighter load control.',
    maxIntensityDaysHardCap: 1,
    maxDoublesHardCap: 0,
    defaultRecoveryEveryNWeeks: 3,
    defaultRecoveryWeekMultiplier: 0.8,
    weekMinuteBands: {
      baseMinRatio: 0.55,
      baseMaxRatio: 1.1,
      constrainedMinRatio: 0.45,
      constrainedMaxRatio: 1.15,
      beginnerEarlyMinRatio: 0.5,
      beginnerEarlyMaxRatio: 1.1,
      severeMinRatio: 0.38,
      severeMaxRatio: 1.22,
    },
  },
  'coachkit-safe-v1': {
    id: 'coachkit-safe-v1',
    version: 'v1',
    label: 'Safe Balanced',
    description: 'Balanced default for broad athlete cohorts with strict guardrails.',
    maxIntensityDaysHardCap: 2,
    maxDoublesHardCap: 1,
    defaultRecoveryEveryNWeeks: 4,
    defaultRecoveryWeekMultiplier: 0.84,
    weekMinuteBands: {
      baseMinRatio: 0.5,
      baseMaxRatio: 1.15,
      constrainedMinRatio: 0.4,
      constrainedMaxRatio: 1.2,
      beginnerEarlyMinRatio: 0.45,
      beginnerEarlyMaxRatio: 1.2,
      severeMinRatio: 0.35,
      severeMaxRatio: 1.3,
    },
  },
  'coachkit-performance-v1': {
    id: 'coachkit-performance-v1',
    version: 'v1',
    label: 'Performance',
    description: 'Higher performance bias with safety limits still enforced.',
    maxIntensityDaysHardCap: 3,
    maxDoublesHardCap: 2,
    defaultRecoveryEveryNWeeks: 4,
    defaultRecoveryWeekMultiplier: 0.86,
    weekMinuteBands: {
      baseMinRatio: 0.45,
      baseMaxRatio: 1.2,
      constrainedMinRatio: 0.38,
      constrainedMaxRatio: 1.25,
      beginnerEarlyMinRatio: 0.42,
      beginnerEarlyMaxRatio: 1.2,
      severeMinRatio: 0.32,
      severeMaxRatio: 1.34,
    },
  },
};

export type PlanningPolicyProfileOverride = Omit<Partial<PlanningPolicyProfile>, 'id' | 'version' | 'weekMinuteBands'> & {
  weekMinuteBands?: Partial<PlanningPolicyProfile['weekMinuteBands']>;
};
export type PlanningPolicyProfileOverrideMap = Partial<Record<PlanningPolicyProfileId, PlanningPolicyProfileOverride>>;

let cachedProfiles: Record<PlanningPolicyProfileId, PlanningPolicyProfile> | null = null;
let runtimeOverrides: PlanningPolicyProfileOverrideMap | null = null;

function invalidateProfileCache() {
  cachedProfiles = null;
}

export function setPlanningPolicyRuntimeOverrides(
  overrides: PlanningPolicyProfileOverrideMap | null
) {
  runtimeOverrides = overrides;
  invalidateProfileCache();
}

export function getPlanningPolicyRuntimeOverrides() {
  return runtimeOverrides;
}

function getProfiles(): Record<PlanningPolicyProfileId, PlanningPolicyProfile> {
  if (cachedProfiles) return cachedProfiles;
  const next: Record<PlanningPolicyProfileId, PlanningPolicyProfile> = {
    'coachkit-conservative-v1': { ...PROFILES['coachkit-conservative-v1'], weekMinuteBands: { ...PROFILES['coachkit-conservative-v1'].weekMinuteBands } },
    'coachkit-safe-v1': { ...PROFILES['coachkit-safe-v1'], weekMinuteBands: { ...PROFILES['coachkit-safe-v1'].weekMinuteBands } },
    'coachkit-performance-v1': { ...PROFILES['coachkit-performance-v1'], weekMinuteBands: { ...PROFILES['coachkit-performance-v1'].weekMinuteBands } },
  };

  const applyOverrides = (parsed: Partial<Record<PlanningPolicyProfileId, PlanningPolicyProfileOverride>> | null | undefined) => {
    if (!parsed) return;
    const ids: PlanningPolicyProfileId[] = ['coachkit-conservative-v1', 'coachkit-safe-v1', 'coachkit-performance-v1'];
    for (const id of ids) {
      const override = parsed?.[id];
      if (!override) continue;
      next[id] = {
        ...next[id],
        ...override,
        id,
        version: 'v1',
        weekMinuteBands: {
          ...next[id].weekMinuteBands,
          ...(override.weekMinuteBands ?? {}),
        },
      };
    }
  };

  const raw = process.env.COACHKIT_APB_POLICY_OVERRIDES_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<PlanningPolicyProfileId, PlanningPolicyProfileOverride>>;
      applyOverrides(parsed);
    } catch {
      // Ignore malformed env override and keep defaults.
    }
  }
  applyOverrides(runtimeOverrides ?? null);

  cachedProfiles = next;
  return next;
}

export function listPlanningPolicyProfiles(): PlanningPolicyProfile[] {
  return Object.values(getProfiles());
}

export function resolvePlanningPolicyProfile(setup: {
  policyProfileId?: string | null;
  riskTolerance?: string | null;
}): PlanningPolicyProfile {
  const profiles = getProfiles();
  const explicit = String(setup.policyProfileId ?? '').trim() as PlanningPolicyProfileId;
  if (explicit && profiles[explicit]) return profiles[explicit];
  if (setup.riskTolerance === 'low') return profiles['coachkit-conservative-v1'];
  if (setup.riskTolerance === 'high') return profiles['coachkit-performance-v1'];
  return profiles['coachkit-safe-v1'];
}

export function applyPlanningPolicyProfileToSetup(setup: DraftPlanSetupV1): DraftPlanSetupV1 {
  const profile = resolvePlanningPolicyProfile(setup);
  return {
    ...setup,
    policyProfileId: profile.id,
    policyProfileVersion: profile.version,
    maxIntensityDaysPerWeek: Math.max(1, Math.min(profile.maxIntensityDaysHardCap, Number(setup.maxIntensityDaysPerWeek ?? 1))),
    maxDoublesPerWeek: Math.max(0, Math.min(profile.maxDoublesHardCap, Number(setup.maxDoublesPerWeek ?? 0))),
    recoveryEveryNWeeks: setup.recoveryEveryNWeeks ?? profile.defaultRecoveryEveryNWeeks,
    recoveryWeekMultiplier: setup.recoveryWeekMultiplier ?? profile.defaultRecoveryWeekMultiplier,
  };
}
