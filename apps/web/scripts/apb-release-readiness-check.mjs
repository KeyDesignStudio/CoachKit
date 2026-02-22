import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function readJson(filePath) {
  const full = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  const raw = fs.readFileSync(full, 'utf8');
  return JSON.parse(raw);
}

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function evaluateQualityGate(report) {
  const summary = report?.summary ?? {};
  const checks = [
    { id: 'q_scenario_count', ok: asNumber(summary.scenarioCount) >= 9, detail: `scenarioCount=${summary.scenarioCount}` },
    { id: 'q_avg_score', ok: asNumber(summary.avgScore) >= 90, detail: `avgScore=${summary.avgScore}` },
    { id: 'q_min_score', ok: asNumber(summary.minScore) >= 80, detail: `minScore=${summary.minScore}` },
    {
      id: 'q_max_hard',
      ok: asNumber(summary.maxHardViolations) <= 0,
      detail: `maxHardViolations=${summary.maxHardViolations}`,
    },
    {
      id: 'q_max_soft',
      ok: asNumber(summary.maxSoftWarnings) <= 5,
      detail: `maxSoftWarnings=${summary.maxSoftWarnings}`,
    },
  ];
  return checks;
}

function evaluateUat(report) {
  const gate = report?.releaseGate ?? {};
  const checks = [
    {
      id: 'u_gate_pass',
      ok: Boolean(gate.pass) === true,
      detail: `releaseGate.pass=${String(gate.pass)}`,
    },
    {
      id: 'u_missing_cases',
      ok: asNumber(gate.missingCaseCount) === 0,
      detail: `missingCaseCount=${gate.missingCaseCount}`,
    },
    {
      id: 'u_blocking_issues',
      ok: asNumber(gate.blockingIssueCount) === 0,
      detail: `blockingIssueCount=${gate.blockingIssueCount}`,
    },
  ];
  return checks;
}

function main() {
  const qualityReport = readJson('apb-quality-gates-report.json');
  const uatReport = readJson('apb-uat-evidence-report.json');

  const qualityChecks = evaluateQualityGate(qualityReport);
  const uatChecks = evaluateUat(uatReport);
  const checks = [...qualityChecks, ...uatChecks];
  const failedChecks = checks.filter((c) => !c.ok);

  const output = {
    generatedAt: new Date().toISOString(),
    status: failedChecks.length === 0 ? 'GO' : 'NO_GO',
    checks,
    failedChecks,
  };

  const md = [
    '# APB Release Readiness',
    '',
    `Generated: ${output.generatedAt}`,
    '',
    `Result: **${output.status}**`,
    '',
    '## Checks',
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |',
    ...checks.map((c) => `| ${c.id} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail} |`),
    '',
    failedChecks.length
      ? `## Blocking Issues\n\n${failedChecks.map((c) => `- ${c.id}: ${c.detail}`).join('\n')}`
      : '## Blocking Issues\n\n- None',
    '',
  ].join('\n');

  fs.writeFileSync(path.resolve(process.cwd(), 'apb-release-readiness.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.resolve(process.cwd(), 'apb-release-readiness.md'), `${md}\n`, 'utf8');

  console.log(`[apb-release-readiness] status=${output.status}`);
  if (failedChecks.length) {
    for (const c of failedChecks) console.error(`[apb-release-readiness] FAIL ${c.id}: ${c.detail}`);
    process.exit(1);
  }
}

main();
