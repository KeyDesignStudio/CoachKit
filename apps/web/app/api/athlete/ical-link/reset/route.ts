import { requireAuth } from '@/lib/auth';
import { forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { rotateIcalToken } from '@/lib/ical-token';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!raw) return 'https://coach-kit.vercel.app';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw.replace(/\/$/, '');
  return `https://${raw.replace(/\/$/, '')}`;
}

function getBaseUrlFromRequestHeaders(): string | null {
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return null;
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`.replace(/\/$/, '');
}

export async function POST() {
  try {
    const { user } = await requireAuth();

    if (user.role !== 'ATHLETE') {
      throw forbidden('Athlete access required.');
    }

    const { token } = await rotateIcalToken(user.id);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim()
      ? getBaseUrl()
      : (getBaseUrlFromRequestHeaders() ?? getBaseUrl());

    const url = `${baseUrl}/api/athlete/calendar.ics?token=${token}`;

    return success({ url });
  } catch (error) {
    return handleError(error);
  }
}
