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

export async function GET() {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const csv = buildGoodCsv();

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(Buffer.byteLength(csv, 'utf8')),
    },
  });
}
