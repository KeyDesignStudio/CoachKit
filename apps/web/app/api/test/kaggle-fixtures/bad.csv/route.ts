import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

// Invalid quotes should generate a PapaParse error.
// Put the invalid quoting in the header row so the loader fails immediately.
const BAD_CSV = `title,"description
Bad Program,ok
`;

export async function GET() {
  const guard = ensureTestOnly();
  if (guard) return guard;

  return new NextResponse(BAD_CSV, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(Buffer.byteLength(BAD_CSV, 'utf8')),
    },
  });
}
