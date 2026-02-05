export type PlanReasoningSeverity = 'low' | 'med' | 'high';

export type PlanReasoningItem = {
  key: string;
  label: string;
};

export type PlanReasoningRisk = {
  key: string;
  label: string;
  severity: PlanReasoningSeverity;
};

export type PlanReasoningTargets = {
  weeklyMinutesTarget: number;
  maxIntensityDaysPerWeek: number;
  maxDoublesPerWeek: number;
  longSessionDay: number | null;
};

export type WeekReasoningV1 = {
  weekIndex: number;
  weekIntent: 'build' | 'consolidate' | 'deload' | 'taper' | 'race';
  volumeMinutesPlanned: number;
  volumeDeltaPct: number;
  intensityDaysPlanned: number;
  disciplineSplitMinutes: {
    swim?: number;
    bike?: number;
    run?: number;
    strength?: number;
    other?: number;
  };
  notes: string[];
};

export type PlanReasoningV1 = {
  version: 'v1';
  generatedAt: string;
  inputsHash: string;
  priorities: PlanReasoningItem[];
  constraints: PlanReasoningItem[];
  risks: PlanReasoningRisk[];
  targets: PlanReasoningTargets;
  explanations: string[];
  weeks: WeekReasoningV1[];
};
