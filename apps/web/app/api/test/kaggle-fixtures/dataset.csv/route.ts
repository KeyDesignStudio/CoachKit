import { NextResponse } from 'next/server';

import { getKaggleFixtureMode } from '@/app/api/test/kaggle-fixtures/_state';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  // Only available in Playwright runs.
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

const GOOD_CSV = `title,description,level,goal,equipment,program_length,time_per_workout,week,day,number_of_exercises,exercise_name,sets,reps,intensity,created,last_edit
Strength Program,Day 1,Beginner,Strength,"Dumbbells",4,45,1,1,2,Goblet Squat,3,10,RPE 7,2024-01-01,2024-01-02
Strength Program,Day 1,Beginner,Strength,"Dumbbells",4,45,1,1,2,Push Up,3,12,RPE 6,2024-01-01,2024-01-02
`;

// Unclosed quote should generate a PapaParse error.
const BAD_CSV = `title,description,level,goal,equipment,program_length,time_per_workout,week,day,number_of_exercises,exercise_name,sets,reps,intensity,created,last_edit
"Bad Program,Day 1,Beginner,Strength,Dumbbells,4,45,1,1,1,Goblet Squat,3,10,RPE 7,2024-01-01,2024-01-02
`;

export async function GET() {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const mode = getKaggleFixtureMode();
  if (mode === 'missing') {
    return new NextResponse('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  const body = mode === 'bad' ? BAD_CSV : GOOD_CSV;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(Buffer.byteLength(body, 'utf8')),
    },
  });
}
