import { providerHealth } from '@/lib/integrations/device-provider-routes';

export const dynamic = 'force-dynamic';

export async function GET() {
  return providerHealth('COROS');
}
