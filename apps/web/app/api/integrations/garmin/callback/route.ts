import { providerCallback } from '@/lib/integrations/device-provider-routes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return providerCallback('GARMIN', request);
}
