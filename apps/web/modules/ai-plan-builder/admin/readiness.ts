import fs from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';

import { evaluateQualityGateV2Scenario } from '@/modules/ai-plan-builder/tests/harness/evaluate-quality-gate-v2';
import { resolveScenarioThresholdsWithPolicyRatchet } from '@/modules/ai-plan-builder/tests/harness/quality-gate-v2-policy-levels';
import { qualityGateV2Scenarios } from '@/modules/ai-plan-builder/tests/harness/quality-gate-v2-scenarios';

export type ReadinessStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export type QualityGateReadiness = {
  status: ReadinessStatus;
  scenarioCount: number;
  failingScenarios: string[];
};

export type UatReadiness = {
  status: ReadinessStatus;
  recordCount: number;
  missingCases: string[];
  hasBlockingSeverity: boolean;
  hasFailures: boolean;
};

const REQUIRED_UAT_CASES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'A1', 'A2', 'A3', 'A4'];

export function evaluateQualityGateReadiness(): QualityGateReadiness {
  const failingScenarios: string[] = [];
  for (const scenario of qualityGateV2Scenarios) {
    const result = evaluateQualityGateV2Scenario(scenario);
    const t = resolveScenarioThresholdsWithPolicyRatchet({ scenario }).effectiveThresholds;

    const pass =
      result.score >= t.minScore &&
      result.hardViolationCount <= t.maxHardViolations &&
      result.softWarningCount <= t.maxSoftWarnings &&
      result.weeklyMinutesInBandRate >= t.minWeeklyMinutesInBandRate &&
      result.keySessionBandPassRate >= t.minKeySessionBandPassRate &&
      result.nonConsecutiveIntensityRate >= t.minNonConsecutiveIntensityRate &&
      result.noLongThenIntensityRate >= t.minNoLongThenIntensityRate &&
      result.explainabilityCoverageRate >= t.minExplainabilityCoverageRate &&
      result.availabilityAdherenceRate >= t.minAvailabilityAdherenceRate &&
      result.doublesComplianceRate >= t.minDoublesComplianceRate &&
      result.intensityCapComplianceRate >= t.minIntensityCapComplianceRate;

    if (!pass) failingScenarios.push(scenario.id);
  }

  return {
    status: failingScenarios.length ? 'FAIL' : 'PASS',
    scenarioCount: qualityGateV2Scenarios.length,
    failingScenarios,
  };
}

export async function evaluateUatReadiness(): Promise<UatReadiness> {
  const csvPath = path.resolve(process.cwd(), '..', '..', 'docs', 'APB_UAT_H2_RESULTS.csv');
  try {
    const raw = await fs.readFile(csvPath, 'utf8');
    const parsed = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) {
      return { status: 'UNKNOWN', recordCount: 0, missingCases: REQUIRED_UAT_CASES, hasBlockingSeverity: false, hasFailures: false };
    }
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const caseIds = new Set(rows.map((r) => String(r.case_id ?? '').trim()).filter(Boolean));
    const missingCases = REQUIRED_UAT_CASES.filter((c) => !caseIds.has(c));

    let hasBlockingSeverity = false;
    let hasFailures = false;
    for (const row of rows) {
      const severity = String(row.severity ?? '').trim().toUpperCase();
      const status = String(row.status ?? '').trim().toUpperCase();
      if (severity === 'P0' || severity === 'P1') hasBlockingSeverity = true;
      if (status === 'FAIL' || status === 'BLOCKED') hasFailures = true;
    }

    const status: ReadinessStatus =
      missingCases.length > 0 || hasBlockingSeverity || hasFailures ? 'FAIL' : rows.length > 0 ? 'PASS' : 'UNKNOWN';

    return {
      status,
      recordCount: rows.length,
      missingCases,
      hasBlockingSeverity,
      hasFailures,
    };
  } catch {
    return { status: 'UNKNOWN', recordCount: 0, missingCases: REQUIRED_UAT_CASES, hasBlockingSeverity: false, hasFailures: false };
  }
}
