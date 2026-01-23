import { requireAuth } from '@/lib/auth';
import { forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { rotateIcalToken } from '@/lib/ical-token';

export const dynamic = 'force-dynamic';

function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!raw) return 'https://coach-kit.vercel.app';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw.replace(/\/$/, '');
  return `https://${raw.replace(/\/$/, '')}`;
}

export async function POST() {
  try {
    const { user } = await requireAuth();

    if (user.role !== 'ATHLETE') {
      throw forbidden('Athlete access required.');
    }

    const { token } = await rotateIcalToken(user.id);

    const url = `${getBaseUrl()}/api/athlete/calendar.ics?token=${token}`;

    return success({ url });
  } catch (error) {
    return handleError(error);
  }
}
