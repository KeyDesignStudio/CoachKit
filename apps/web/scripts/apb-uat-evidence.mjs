import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Papa from 'papaparse';

const REQUIRED_FIELDS = [
  'run_id',
  'tester_role',
  'case_id',
  'status',
  'severity',
  'actual_result',
  'expected_result',
  'url',
  'screenshot_path',
  'notes',
];

const REQUIRED_CASES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'A1', 'A2', 'A3', 'A4'];
const CRITICAL_CASES = new Set(['C1', 'C2', 'C3', 'C5', 'C6', 'C7', 'C8', 'A1', 'A2', 'A3']);

const VALID_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED']);
const VALID_SEVERITIES = new Set(['P0', 'P1', 'P2', 'P3', 'NA']);

function normalize(value) {
  return String(value ?? '').trim();
}

function parseArgs(argv) {
  const args = new Map();
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [k, ...rest] = raw.slice(2).split('=');
    args.set(k, rest.join('=') || '1');
  }
  return args;
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# APB UAT Evidence Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Gate Outcome');
  lines.push('');
  lines.push(`- Result: **${report.releaseGate.pass ? 'PASS' : 'FAIL'}**`);
  lines.push(`- Blocking issues: ${report.releaseGate.blockingIssueCount}`);
  lines.push(`- Missing required cases: ${report.releaseGate.missingCaseCount}`);
  lines.push(`- Status format issues: ${report.releaseGate.formatIssueCount}`);
  lines.push('');
  lines.push('## Coverage Summary');
  lines.push('');
  lines.push(`- Runs detected: ${report.summary.runCount}`);
  lines.push(`- Records parsed: ${report.summary.recordCount}`);
  lines.push(`- Required cases present: ${report.summary.requiredCasesPresent}/${REQUIRED_CASES.length}`);
  lines.push(`- PASS: ${report.summary.statusCounts.PASS}`);
  lines.push(`- FAIL: ${report.summary.statusCounts.FAIL}`);
  lines.push(`- BLOCKED: ${report.summary.statusCounts.BLOCKED}`);
  lines.push('');
  lines.push('## Critical Cases');
  lines.push('');
  lines.push('| Case | Status | Severity | Tester | Run ID |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const row of report.criticalCases) {
    lines.push(`| ${row.case_id} | ${row.status} | ${row.severity} | ${row.tester_role} | ${row.run_id} |`);
  }
  lines.push('');
  if (report.issues.length) {
    lines.push('## Issues');
    lines.push('');
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }
  lines.push('## Notes');
  lines.push('');
  lines.push('- Source CSV: `docs/APB_UAT_H2_RESULTS.csv` (or `--csv=<path>` override).');
  lines.push('- Release gate requires no `P0/P1`, no FAIL/BLOCKED critical cases, and all required cases present.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const csvPath = path.resolve(process.cwd(), args.get('csv') ?? path.join('..', '..', 'docs', 'APB_UAT_H2_RESULTS.csv'));
  const outJson = path.resolve(process.cwd(), args.get('outJson') ?? 'apb-uat-evidence-report.json');
  const outMd = path.resolve(process.cwd(), args.get('outMd') ?? 'apb-uat-evidence-report.md');

  if (!fs.existsSync(csvPath)) {
    console.error(`[apb-uat-evidence] CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const csvRaw = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(csvRaw, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length) {
    console.error('[apb-uat-evidence] CSV parse errors detected.');
    for (const err of parsed.errors) {
      console.error(`- row ${err.row}: ${err.message}`);
    }
    process.exit(1);
  }

  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const issues = [];
  const fieldNames = Array.isArray(parsed.meta.fields) ? parsed.meta.fields : [];
  for (const field of REQUIRED_FIELDS) {
    if (!fieldNames.includes(field)) {
      issues.push(`Missing required CSV column: ${field}`);
    }
  }

  const cleanRows = rows.map((row) => {
    const normalized = {};
    for (const k of REQUIRED_FIELDS) {
      normalized[k] = normalize(row?.[k]);
    }
    return normalized;
  });

  const runIds = new Set(cleanRows.map((r) => r.run_id).filter(Boolean));
  const requiredCaseMap = new Map();
  const statusCounts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  const severityCounts = { P0: 0, P1: 0, P2: 0, P3: 0, NA: 0 };
  const criticalCases = [];
  const failingCriticalCases = [];
  let formatIssueCount = 0;
  let blockingIssueCount = 0;

  for (const row of cleanRows) {
    requiredCaseMap.set(row.case_id, row);

    if (!VALID_STATUSES.has(row.status)) {
      issues.push(`Invalid status "${row.status}" for case ${row.case_id || '<unknown>'}`);
      formatIssueCount += 1;
    } else {
      statusCounts[row.status] += 1;
    }

    if (!VALID_SEVERITIES.has(row.severity)) {
      issues.push(`Invalid severity "${row.severity}" for case ${row.case_id || '<unknown>'}`);
      formatIssueCount += 1;
    } else {
      severityCounts[row.severity] += 1;
    }

    if ((row.status === 'FAIL' || row.status === 'BLOCKED') && !['P0', 'P1', 'P2', 'P3'].includes(row.severity)) {
      issues.push(`Case ${row.case_id} has status ${row.status} but severity is not P0-P3.`);
      formatIssueCount += 1;
    }

    if (row.severity === 'P0' || row.severity === 'P1') {
      blockingIssueCount += 1;
    }

    if (CRITICAL_CASES.has(row.case_id)) {
      criticalCases.push(row);
      if (row.status !== 'PASS') {
        failingCriticalCases.push(row);
      }
    }
  }

  const missingCases = REQUIRED_CASES.filter((caseId) => !requiredCaseMap.has(caseId));
  for (const missing of missingCases) {
    issues.push(`Missing required case result: ${missing}`);
  }

  const releaseGatePass =
    issues.length === 0 &&
    missingCases.length === 0 &&
    blockingIssueCount === 0 &&
    failingCriticalCases.length === 0 &&
    statusCounts.FAIL === 0 &&
    statusCounts.BLOCKED === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    sourceCsv: path.relative(repoRoot, csvPath),
    summary: {
      runCount: runIds.size,
      recordCount: cleanRows.length,
      requiredCasesPresent: REQUIRED_CASES.length - missingCases.length,
      statusCounts,
      severityCounts,
    },
    releaseGate: {
      pass: releaseGatePass,
      blockingIssueCount,
      missingCaseCount: missingCases.length,
      formatIssueCount,
      failingCriticalCaseCount: failingCriticalCases.length,
    },
    criticalCases: criticalCases.map((row) => ({
      run_id: row.run_id,
      tester_role: row.tester_role,
      case_id: row.case_id,
      status: row.status,
      severity: row.severity,
    })),
    failingCriticalCases: failingCriticalCases.map((row) => ({
      run_id: row.run_id,
      tester_role: row.tester_role,
      case_id: row.case_id,
      status: row.status,
      severity: row.severity,
      notes: row.notes,
    })),
    issues,
  };

  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outMd, buildMarkdownReport(report), 'utf8');

  console.log(`[apb-uat-evidence] Source: ${csvPath}`);
  console.log(`[apb-uat-evidence] JSON report: ${outJson}`);
  console.log(`[apb-uat-evidence] Markdown report: ${outMd}`);
  console.log(`[apb-uat-evidence] Gate: ${releaseGatePass ? 'PASS' : 'FAIL'}`);
}

main();
