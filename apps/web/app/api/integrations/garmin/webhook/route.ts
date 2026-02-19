import { NextRequest } from 'next/server';

import { providerWebhookGet, providerWebhookPost } from '@/lib/integrations/device-provider-routes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return providerWebhookGet('GARMIN', request);
}

export async function POST(request: NextRequest) {
  return providerWebhookPost('GARMIN', request);
}
