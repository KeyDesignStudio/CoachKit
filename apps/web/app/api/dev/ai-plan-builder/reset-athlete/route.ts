import { NextRequest, NextResponse } from 'next/server';

import {
  aiPlanBuilderResetAthleteSchema,
  resetAiPlanBuilderStateForAthlete,
} from '@/modules/ai-plan-builder/server/reset-athlete';

export const dynamic = 'force-dynamic';

function isEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.DISABLE_AUTH === 'true';
}

export async function POST(request: NextRequest) {
  if (!isEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = aiPlanBuilderResetAthleteSchema.parse(await request.json().catch(() => ({})));
  const result = await resetAiPlanBuilderStateForAthlete({ athleteId: body.athleteId, dryRun: body.dryRun });

  return NextResponse.json({ ok: true, ...result });
}
