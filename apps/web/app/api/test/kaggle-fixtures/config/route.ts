import { NextRequest, NextResponse } from 'next/server';

import { getKaggleFixtureMode, setKaggleFixtureMode } from '@/app/api/test/kaggle-fixtures/_state';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  // Only available in Playwright runs.
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

export async function GET() {
  const guard = ensureTestOnly();
  if (guard) return guard;
  return NextResponse.json({ ok: true, mode: getKaggleFixtureMode() });
}

export async function POST(request: NextRequest) {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const body = (await request.json().catch(() => null)) as any;
  const next = body?.mode;
  if (next !== 'good' && next !== 'bad' && next !== 'missing') {
    return NextResponse.json({ ok: false, error: 'Invalid mode' }, { status: 400 });
  }

  setKaggleFixtureMode(next);
  return NextResponse.json({ ok: true, mode: getKaggleFixtureMode() });
}
