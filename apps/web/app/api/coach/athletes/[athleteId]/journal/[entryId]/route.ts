import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { athleteId: string; entryId: string } }
) {
  try {
    const { user } = await requireCoach();
    const { athleteId, entryId } = params;

    // Verify the entry exists and belongs to this coach and athlete
    const entry = await prisma.coachJournalEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry) {
      throw new ApiError(404, 'ENTRY_NOT_FOUND', 'Journal entry not found');
    }

    if (entry.coachId !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to delete this entry');
    }

    if (entry.athleteId !== athleteId) {
      throw new ApiError(404, 'ENTRY_NOT_FOUND', 'Entry does not belong to this athlete');
    }

    // Delete the entry
    await prisma.coachJournalEntry.delete({
      where: { id: entryId },
    });

    return success({ message: 'Entry deleted successfully' });
  } catch (error) {
    return handleError(error);
  }
}
