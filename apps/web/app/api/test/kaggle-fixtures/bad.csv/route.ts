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

function parseRangeHeader(range: string | null, total: number): { start: number; end: number } | null {
  if (!range) return null;
  const m = /^bytes=(\d+)-(\d+)?$/.exec(range.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const endRaw = m[2];
  const end = endRaw ? Number(endRaw) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  if (start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

export async function HEAD() {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const total = Buffer.byteLength(BAD_CSV, 'utf8');
  return new NextResponse(null, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(total),
      'accept-ranges': 'bytes',
    },
  });
}

export async function GET(request: Request) {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const buf = Buffer.from(BAD_CSV, 'utf8');
  const total = buf.byteLength;
  const range = parseRangeHeader(request.headers.get('range'), total);

  if (!range) {
    return new NextResponse(BAD_CSV, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-length': String(total),
        'accept-ranges': 'bytes',
      },
    });
  }

  const { start, end } = range;
  const chunk = buf.subarray(start, end + 1);
  return new NextResponse(new Uint8Array(chunk), {
    status: 206,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(chunk.byteLength),
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${total}`,
    },
  });
}
