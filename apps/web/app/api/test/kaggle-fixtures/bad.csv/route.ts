import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

// Unclosed quote should generate a PapaParse error.
const BAD_CSV = `title,description,level,goal,equipment,program_length,time_per_workout,week,day,number_of_exercises,exercise_name,sets,reps,intensity,created,last_edit
"Bad Program,Day 1,Beginner,Strength,Dumbbells,4,45,1,1,1,Goblet Squat,3,10,RPE 7,2024-01-01,2024-01-02
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
