import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

export async function GET() {
  const guard = ensureTestOnly();
  if (guard) return guard;

  return new NextResponse('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
