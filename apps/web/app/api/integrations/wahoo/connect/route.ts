import { providerConnect } from '@/lib/integrations/device-provider-routes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return providerConnect('WAHOO', request);
}
