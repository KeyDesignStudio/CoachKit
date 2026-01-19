import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

function safeTestTag(): string {
  const raw = (process.env.KAGGLE_TEST_TAG ?? '').trim();
  if (!raw) return 'static';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned || 'static';
}

const HEADER =
  'title,description,level,goal,equipment,program_length,time_per_workout,week,day,number_of_exercises,exercise_name,sets,reps,intensity,created,last_edit\n';

function buildLargeCsv(): Buffer {
  const tag = safeTestTag();
  const title = `Strength Program ${tag}`;

  // Build a CSV large enough to require multiple 2MB range requests
  // when using a high offset. Keep it deterministic.
  const longText = 'A'.repeat(900);

  const lines: string[] = [];
  lines.push(HEADER.trimEnd());
  const rowCount = 7000;
  for (let i = 1; i <= rowCount; i++) {
    const week = Math.floor((i - 1) / 7) + 1;
    const day = ((i - 1) % 7) + 1;
    const exercise = `Exercise ${i}`;
    const desc = `Day ${i} ${longText}`;
    lines.push(
      `${title},"${desc}",Beginner,Strength,"Dumbbells",12,45,${week},${day},1,${exercise},3,10,RPE 7,2024-01-01,2024-01-02`
    );
  }

  const csv = lines.join('\n') + '\n';
  return Buffer.from(csv, 'utf8');
}

let cached: Buffer | null = null;
function getCsv(): Buffer {
  if (!cached) cached = buildLargeCsv();
  return cached;
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

  const csv = getCsv();
  return new NextResponse(null, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(csv.byteLength),
      'accept-ranges': 'bytes',
    },
  });
}

export async function GET(request: Request) {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const csv = getCsv();
  const total = csv.byteLength;
  const range = parseRangeHeader(request.headers.get('range'), total);

  if (!range) {
    // For completeness: return full file if no Range header.
    return new NextResponse(new Uint8Array(csv), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-length': String(total),
        'accept-ranges': 'bytes',
      },
    });
  }

  const { start, end } = range;
  const chunk = csv.subarray(start, end + 1);
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
