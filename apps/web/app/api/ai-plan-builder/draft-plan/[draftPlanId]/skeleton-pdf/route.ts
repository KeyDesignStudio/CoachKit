import { NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';

import { requireAuth } from '@/lib/auth';
import { handleError } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { buildSkeletonPdfBuffer } from '@/modules/ai-plan-builder/server/skeleton-pdf';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: { draftPlanId: string } }) {
  try {
    const { user } = await requireAuth();
    const draftPlanId = String(context.params.draftPlanId ?? '');
    if (!draftPlanId) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'draftPlanId is required.' } }, { status: 400 });
    }

    const draft = await prisma.aiPlanDraft.findUnique({
      where: { id: draftPlanId },
      select: {
        id: true,
        athleteId: true,
        coachId: true,
        setupJson: true,
        sessions: {
          orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
          select: {
            weekIndex: true,
            dayOfWeek: true,
            discipline: true,
            type: true,
            durationMinutes: true,
            notes: true,
          },
        },
        athlete: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    if (!draft) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Draft plan not found.' } }, { status: 404 });
    }

    const isCoachAccess = user.role === UserRole.COACH || user.role === UserRole.ADMIN;
    if (isCoachAccess && draft.coachId !== user.id) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Coach access required.' } }, { status: 403 });
    }
    if (user.role === UserRole.ATHLETE && draft.athleteId !== user.id) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Athlete access required.' } }, { status: 403 });
    }

    const setup = draft.setupJson && typeof draft.setupJson === 'object' ? (draft.setupJson as Record<string, unknown>) : {};
    const weekStart = setup.weekStart === 'sunday' ? 'sunday' : 'monday';
    const startDate = typeof setup.startDate === 'string' ? setup.startDate : new Date().toISOString().slice(0, 10);
    const athleteName = [draft.athlete.firstName, draft.athlete.lastName].filter(Boolean).join(' ').trim() || draft.athlete.user?.name || 'Athlete';

    const pdf = buildSkeletonPdfBuffer({
      athleteName,
      startDate,
      weekStart,
      sessions: draft.sessions,
    });

    const filename = `coachkit-draft-plan-${draft.id}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
