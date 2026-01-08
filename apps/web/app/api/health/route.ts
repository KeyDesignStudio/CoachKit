import { success } from '@/lib/http';

export async function GET() {
  return success({ status: 'ok', timestamp: new Date().toISOString() });
}
