import type { AiAdaptationTriggerType } from '../ai/types';

type TriggerLike = {
  id: string;
  triggerType: AiAdaptationTriggerType | string;
  evidenceJson?: unknown;
};

export type TriggerQuality = {
  triggerId: string;
  triggerType: string;
  confidence: number; // 0..1
  impact: 'low' | 'medium' | 'high';
  reason: string;
};

export type TriggerAssessment = {
  ranked: TriggerQuality[];
  averageConfidence: number;
  highImpactCount: number;
  shouldQueue: boolean;
  suppressionReason?: string;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scoreSoreness(evidence: any): number {
  const sorenessCount = Number(evidence?.sorenessCount ?? 0);
  return clamp01(0.45 + Math.min(0.45, sorenessCount * 0.18));
}

function scoreTooHard(evidence: any): number {
  const tooHardCount = Number(evidence?.tooHardCount ?? 0);
  return clamp01(0.4 + Math.min(0.5, tooHardCount * 0.16));
}

function scoreMissedKey(evidence: any): number {
  const missedKeyCount = Number(evidence?.missedKeyCount ?? 0);
  return clamp01(0.45 + Math.min(0.45, missedKeyCount * 0.17));
}

function scoreHighCompliance(evidence: any): number {
  const compliance = Number(evidence?.compliance ?? 0);
  const total = Number(evidence?.totalFeedbackCount ?? 0);
  return clamp01(0.25 + compliance * 0.4 + Math.min(0.2, total * 0.02));
}

function impactForTrigger(type: string, confidence: number): 'low' | 'medium' | 'high' {
  const t = String(type);
  if (t === 'SORENESS' || t === 'MISSED_KEY') return confidence >= 0.55 ? 'high' : 'medium';
  if (t === 'TOO_HARD') return confidence >= 0.6 ? 'high' : 'medium';
  if (t === 'HIGH_COMPLIANCE') return confidence >= 0.65 ? 'medium' : 'low';
  return confidence >= 0.65 ? 'medium' : 'low';
}

function reasonForTrigger(type: string, evidence: any): string {
  const t = String(type);
  if (t === 'SORENESS') return `${Number(evidence?.sorenessCount ?? 0)} soreness flags in recent sessions.`;
  if (t === 'TOO_HARD') return `${Number(evidence?.tooHardCount ?? 0)} sessions reported as too hard.`;
  if (t === 'MISSED_KEY') return `${Number(evidence?.missedKeyCount ?? 0)} key sessions skipped.`;
  if (t === 'HIGH_COMPLIANCE') return `Completion ${Math.round(Number(evidence?.compliance ?? 0) * 100)}% with no negative flags.`;
  return 'Trigger signal detected.';
}

function confidenceForTrigger(type: string, evidence: any): number {
  const t = String(type);
  if (t === 'SORENESS') return scoreSoreness(evidence);
  if (t === 'TOO_HARD') return scoreTooHard(evidence);
  if (t === 'MISSED_KEY') return scoreMissedKey(evidence);
  if (t === 'HIGH_COMPLIANCE') return scoreHighCompliance(evidence);
  return 0.45;
}

export function assessTriggerQuality(triggers: TriggerLike[]): TriggerAssessment {
  const ranked = triggers
    .map((t) => {
      const evidence = (t.evidenceJson ?? {}) as any;
      const confidence = confidenceForTrigger(String(t.triggerType), evidence);
      return {
        triggerId: String(t.id),
        triggerType: String(t.triggerType),
        confidence,
        impact: impactForTrigger(String(t.triggerType), confidence),
        reason: reasonForTrigger(String(t.triggerType), evidence),
      } satisfies TriggerQuality;
    })
    .sort((a, b) => b.confidence - a.confidence || a.triggerType.localeCompare(b.triggerType));

  const averageConfidence = ranked.length ? ranked.reduce((sum, r) => sum + r.confidence, 0) / ranked.length : 0;
  const highImpactCount = ranked.filter((r) => r.impact === 'high').length;
  const lowSignals = ranked.filter((r) => r.confidence < 0.52).length;
  const shouldQueue = ranked.length > 0 && !(highImpactCount === 0 && averageConfidence < 0.55 && lowSignals === ranked.length);
  const suppressionReason = shouldQueue
    ? undefined
    : 'Signals are low-confidence and low-impact. CoachKit is suppressing noisy recommendation churn.';

  return { ranked, averageConfidence, highImpactCount, shouldQueue, suppressionReason };
}

function expectedEffectFromTriggerTypes(triggerTypes: string[]) {
  if (triggerTypes.some((t) => t === 'SORENESS' || t === 'TOO_HARD')) return 'Reduce acute stress and improve recovery readiness next week.';
  if (triggerTypes.some((t) => t === 'MISSED_KEY')) return 'Stabilize consistency and protect completion of key sessions.';
  if (triggerTypes.some((t) => t === 'HIGH_COMPLIANCE')) return 'Apply small, safe progression while preserving durability.';
  return 'Adjust next block to improve adherence and training quality.';
}

export function buildReasonChain(params: {
  ranked: TriggerQuality[];
  actionSummary: string;
}) {
  const triggerTypes = params.ranked.map((r) => r.triggerType);
  const signalPart = params.ranked
    .slice(0, 2)
    .map((r) => `${r.triggerType} (${Math.round(r.confidence * 100)}%)`)
    .join(', ');
  return [
    `Signal: ${signalPart || 'recent athlete feedback/activity'}`,
    `Trigger: ${triggerTypes.length ? triggerTypes.join(', ') : 'none'}`,
    `Action: ${params.actionSummary}`,
    `Expected effect: ${expectedEffectFromTriggerTypes(triggerTypes)}`,
  ];
}
