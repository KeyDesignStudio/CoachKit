import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PLAN_COUNT = 55;

function requireTestFixturesEnabled(): Response | null {
  if (process.env.DISABLE_AUTH !== 'true') {
    return new NextResponse('Not Found', { status: 404 });
  }

  return null;
}

export function csvResponse(text: string): Response {
  return new NextResponse(text, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  });
}

export function getPlansCsv(): string {
  const header = ['plan_id', 'plan_name', 'tags', 'source_file', 'goal_distances', 'goal_times'].join(',');
  const rows: string[] = [header];

  for (let i = 1; i <= PLAN_COUNT; i++) {
    const id = `p${String(i).padStart(3, '0')}`;
    rows.push([id, `Plan ${id}`, 'base', 'fixture', '', ''].join(','));
  }

  return rows.join('\n') + '\n';
}

export function getSessionsCsv(): string {
  const header = [
    'session_id',
    'discipline',
    'category',
    'instructions',
    'raw_text',
    'duration_min',
    'distance_prescription_target',
    'distance_prescription_unit',
    'intensity_zone_target',
    'intensity_hint',
    'equipment',
  ].join(',');

  const rows: string[] = [header];

  for (let i = 1; i <= PLAN_COUNT; i++) {
    const id = `s${String(i).padStart(3, '0')}`;
    rows.push([id, 'RUN', 'Easy', `Do session ${id}`, '', '30', '5', 'km', '2', '', ''].join(','));
  }

  return rows.join('\n') + '\n';
}

export function getScheduleCsv(): string {
  const header = [
    'plan_id',
    'session_id',
    'week',
    'day',
    'ordinal',
    'is_optional',
    'is_off',
    'raw_text',
  ].join(',');

  // IMPORTANT: references plan/session rows that appear AFTER the first 50 rows.
  // This catches regressions where dataset=ALL incorrectly applies limit/offset to PLANS/SESSIONS.
  const planId = 'p055';
  const sessionId = 's055';

  const rows: string[] = [header];
  rows.push([planId, sessionId, '1', '1', '0', 'false', 'false', ''].join(','));
  rows.push([planId, sessionId, '1', '2', '0', 'false', 'false', ''].join(','));
  rows.push([planId, '', '1', '3', '0', 'false', 'true', 'Rest day'].join(','));

  return rows.join('\n') + '\n';
}

export function guardTestFixtures(): Response | null {
  return requireTestFixturesEnabled();
}
