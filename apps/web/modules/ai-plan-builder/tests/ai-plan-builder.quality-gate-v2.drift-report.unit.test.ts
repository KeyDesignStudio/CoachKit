import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateQualityGateV2Scenario } from './harness/evaluate-quality-gate-v2';
import { resolveQualityGateV2PolicyLevel } from './harness/quality-gate-v2-policy-levels';
import { qualityGateV2Scenarios } from './harness/quality-gate-v2-scenarios';

type EvalRow = ReturnType<typeof evaluateQualityGateV2Scenario>;

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function avg(rows: EvalRow[], key: keyof EvalRow) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length;
}

function min(rows: EvalRow[], key: keyof EvalRow) {
  if (!rows.length) return 0;
  return Math.min(...rows.map((row) => Number(row[key] ?? Number.POSITIVE_INFINITY)));
}

describe('ai-plan-builder quality gate v2 drift report', () => {
  it('writes a drift report artifact for CI visibility', () => {
    const rows = qualityGateV2Scenarios.map((scenario) => evaluateQualityGateV2Scenario(scenario));
    const byPolicy = qualityGateV2Scenarios.reduce<Record<string, EvalRow[]>>((acc, scenario) => {
      const level = resolveQualityGateV2PolicyLevel(scenario.setup);
      acc[level] = acc[level] ?? [];
      acc[level]!.push(evaluateQualityGateV2Scenario(scenario));
      return acc;
    }, {});

    const summary = {
      generatedAt: new Date().toISOString(),
      scenarioCount: rows.length,
      avgScore: round(avg(rows, 'score')),
      minScore: round(min(rows, 'score')),
      avgWeeklyMinutesInBandRate: round(avg(rows, 'weeklyMinutesInBandRate')),
      avgKeySessionBandPassRate: round(avg(rows, 'keySessionBandPassRate')),
      avgNonConsecutiveIntensityRate: round(avg(rows, 'nonConsecutiveIntensityRate')),
      avgNoLongThenIntensityRate: round(avg(rows, 'noLongThenIntensityRate')),
      avgExplainabilityCoverageRate: round(avg(rows, 'explainabilityCoverageRate')),
      avgAvailabilityAdherenceRate: round(avg(rows, 'availabilityAdherenceRate')),
      avgDoublesComplianceRate: round(avg(rows, 'doublesComplianceRate')),
      avgIntensityCapComplianceRate: round(avg(rows, 'intensityCapComplianceRate')),
      maxHardViolations: Math.max(...rows.map((row) => Number(row.hardViolationCount ?? 0))),
      maxSoftWarnings: Math.max(...rows.map((row) => Number(row.softWarningCount ?? 0))),
    };

    const policySummary = Object.fromEntries(
      Object.entries(byPolicy).map(([policy, policyRows]) => [
        policy,
        {
          scenarioCount: policyRows.length,
          avgScore: round(avg(policyRows, 'score')),
          minScore: round(min(policyRows, 'score')),
          maxHardViolations: Math.max(...policyRows.map((row) => Number(row.hardViolationCount ?? 0))),
          maxSoftWarnings: Math.max(...policyRows.map((row) => Number(row.softWarningCount ?? 0))),
        },
      ])
    );

    const baselinePath = path.resolve(process.cwd(), 'modules/ai-plan-builder/tests/harness/quality-gate-v2-baseline.json');
    const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
    const driftKeys = [
      'scenarioCount',
      'avgScore',
      'minScore',
      'avgWeeklyMinutesInBandRate',
      'avgKeySessionBandPassRate',
      'avgNonConsecutiveIntensityRate',
      'avgNoLongThenIntensityRate',
      'avgExplainabilityCoverageRate',
      'avgAvailabilityAdherenceRate',
      'avgDoublesComplianceRate',
      'avgIntensityCapComplianceRate',
    ] as const;

    const drift = driftKeys.map((key) => {
      const current = Number(summary[key] ?? 0);
      const baselineValue = Number(baseline?.summary?.[key] ?? Number.NaN);
      return {
        key,
        current,
        baseline: Number.isFinite(baselineValue) ? baselineValue : null,
        delta: Number.isFinite(baselineValue) ? round(current - baselineValue) : null,
      };
    });

    const report = {
      summary,
      policySummary,
      scenarios: rows.map((row) => ({
        scenarioId: row.scenarioId,
        score: row.score,
        hardViolationCount: row.hardViolationCount,
        softWarningCount: row.softWarningCount,
        weeklyMinutesInBandRate: row.weeklyMinutesInBandRate,
        keySessionBandPassRate: row.keySessionBandPassRate,
        explainabilityCoverageRate: row.explainabilityCoverageRate,
        weekCount: row.weekCount,
        totalSessionCount: row.totalSessionCount,
      })),
      drift,
    };

    const markdown = [
      '# APB Quality Gates Drift Report',
      '',
      `Generated: ${summary.generatedAt}`,
      '',
      '## Summary',
      '',
      `- Scenarios: ${summary.scenarioCount}`,
      `- Average score: ${summary.avgScore}`,
      `- Minimum score: ${summary.minScore}`,
      `- Max hard violations: ${summary.maxHardViolations}`,
      `- Max soft warnings: ${summary.maxSoftWarnings}`,
      '',
      '## Drift vs Baseline',
      '',
      baseline ? '| Metric | Baseline | Current | Delta |' : '- No baseline file found; deltas unavailable.',
      baseline ? '| --- | ---: | ---: | ---: |' : '',
      ...(
        baseline
          ? drift.map((row) => `| ${row.key} | ${row.baseline ?? 'n/a'} | ${row.current} | ${row.delta ?? 'n/a'} |`)
          : []
      ),
      '',
      '## Scenario Scores',
      '',
      '| Scenario | Score | Hard | Soft |',
      '| --- | ---: | ---: | ---: |',
      ...rows.map((row) => `| ${row.scenarioId} | ${round(row.score)} | ${row.hardViolationCount} | ${row.softWarningCount} |`),
      '',
    ].join('\n');

    const jsonOut = path.resolve(process.cwd(), 'apb-quality-gates-report.json');
    const mdOut = path.resolve(process.cwd(), 'apb-quality-gates-report.md');
    fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(mdOut, `${markdown}\n`, 'utf8');

    expect(summary.scenarioCount).toBeGreaterThanOrEqual(9);
    expect(summary.maxHardViolations).toBeLessThanOrEqual(0);
  });
});
