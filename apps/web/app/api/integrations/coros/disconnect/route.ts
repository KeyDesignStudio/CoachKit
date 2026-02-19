import { providerDisconnect } from '@/lib/integrations/device-provider-routes';

export const dynamic = 'force-dynamic';

export async function POST() {
  return providerDisconnect('COROS');
}
