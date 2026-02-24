import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { sendTrainingRequestInviteEmail } from '@/lib/invite-email';
import { prisma } from '@/lib/prisma';

const payloadSchema = z.object({
  athleteIds: z.array(z.string().min(1)).min(1).max(200),
});

function buildOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`;
  }

  const host = request.headers.get('host');
  if (host) {
    const proto = host.includes('localhost') ? 'http' : 'https';
    return `${proto}://${host}`;
  }

  const fallback =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    'http://localhost:3000';
  return fallback.startsWith('http') ? fallback : `https://${fallback}`;
}

function buildInviteLink(origin: string, email: string): string {
  const redirect = encodeURIComponent('/athlete/training-request');
  return `${origin}/sign-up?redirect_url=${redirect}&email_address=${encodeURIComponent(email)}`;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = payloadSchema.parse(await request.json());

    const uniqueAthleteIds = Array.from(new Set(payload.athleteIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!uniqueAthleteIds.length) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'No valid athlete IDs provided.');
    }

    const athletes = await prisma.athleteProfile.findMany({
      where: {
        coachId: user.id,
        userId: { in: uniqueAthleteIds },
      },
      include: {
        user: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });

    if (athletes.length !== uniqueAthleteIds.length) {
      throw new ApiError(403, 'FORBIDDEN', 'One or more athletes are unavailable for invites.');
    }

    const branding = await prisma.coachBranding.findUnique({
      where: { coachId: user.id },
      select: { displayName: true },
    });

    const origin = buildOrigin(request);
    const coachName = String(user.name || 'Your coach');
    const squadName = String(branding?.displayName || 'CoachKit');

    const results: Array<{
      athleteId: string;
      email: string;
      name: string;
      inviteLink: string;
      sent: boolean;
      provider: 'resend' | 'postmark' | 'ses' | null;
      messageId: string | null;
      error: string | null;
    }> = [];

    for (const athlete of athletes) {
      const email = String(athlete.email || athlete.user.email || '').trim().toLowerCase();
      const name = String(athlete.firstName || athlete.user.name || 'Athlete');
      const inviteLink = buildInviteLink(origin, email);
      if (!email) {
        results.push({
          athleteId: athlete.userId,
          email: '',
          name,
          inviteLink,
          sent: false,
          provider: null,
          messageId: null,
          error: 'Missing athlete email.',
        });
        continue;
      }

      try {
        const sent = await sendTrainingRequestInviteEmail({
          toEmail: email,
          toName: name,
          inviteLink,
          coachName,
          squadName,
        });

        results.push({
          athleteId: athlete.userId,
          email,
          name,
          inviteLink,
          sent: true,
          provider: sent.provider,
          messageId: sent.messageId,
          error: null,
        });
      } catch (error) {
        results.push({
          athleteId: athlete.userId,
          email,
          name,
          inviteLink,
          sent: false,
          provider: null,
          messageId: null,
          error: error instanceof Error ? error.message : 'Invite send failed.',
        });
      }
    }

    const sentCount = results.filter((r) => r.sent).length;
    const failedCount = results.length - sentCount;

    return success({
      sentCount,
      failedCount,
      results,
    });
  } catch (error) {
    return handleError(error);
  }
}

