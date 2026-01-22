import { csvResponse, getPlansCsv, guardTestFixtures } from '../_shared';

export { dynamic, runtime } from '../_shared';

export async function GET() {
  const blocked = guardTestFixtures();
  if (blocked) return blocked;

  return csvResponse(getPlansCsv());
}

export async function HEAD() {
  const blocked = guardTestFixtures();
  if (blocked) return blocked;

  // Next.js does not automatically map HEAD -> GET for route handlers.
  // Plan Library import performs a HEAD to validate dataset size/type.
  return csvResponse(getPlansCsv());
}
