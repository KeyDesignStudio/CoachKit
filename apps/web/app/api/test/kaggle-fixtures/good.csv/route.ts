import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

const GOOD_CSV = `title,description,level,goal,equipment,program_length,time_per_workout,week,day,number_of_exercises,exercise_name,sets,reps,intensity,created,last_edit
Strength Program,Day 1,Beginner,Strength,"Dumbbells",4,45,1,1,2,Goblet Squat,3,10,RPE 7,2024-01-01,2024-01-02
Strength Program,Day 1,Beginner,Strength,"Dumbbells",4,45,1,1,2,Push Up,3,12,RPE 6,2024-01-01,2024-01-02
`;

function safeTestTag(): string {
  const raw = (process.env.KAGGLE_TEST_TAG ?? '').trim();
  if (!raw) return 'static';
  // Keep CSV simple and stable: only allow safe characters.
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned || 'static';
}

function buildGoodCsv(): string {
  const tag = safeTestTag();
  const title = `Strength Program ${tag}`;
  return `title,description,level,goal,equipment,program_length,time_per_workout,week,day,number_of_exercises,exercise_name,sets,reps,intensity,created,last_edit\n` +
    `${title},Day 1,Beginner,Strength,"Dumbbells",4,45,1,1,2,Goblet Squat,3,10,RPE 7,2024-01-01,2024-01-02\n` +
    `${title},Day 1,Beginner,Strength,"Dumbbells",4,45,1,1,2,Push Up,3,12,RPE 6,2024-01-01,2024-01-02\n`;
}

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

  const csv = buildGoodCsv();
  const total = Buffer.byteLength(csv, 'utf8');
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

  const csv = buildGoodCsv();

  const buf = Buffer.from(csv, 'utf8');
  const total = buf.byteLength;
  const range = parseRangeHeader(request.headers.get('range'), total);

  if (!range) {
    return new NextResponse(csv, {
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
