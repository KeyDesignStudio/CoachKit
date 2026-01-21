import { csvResponse, getScheduleCsv, guardTestFixtures } from '../_shared';

export { dynamic, runtime } from '../_shared';

export async function GET() {
  const blocked = guardTestFixtures();
  if (blocked) return blocked;

  return csvResponse(getScheduleCsv());
}
