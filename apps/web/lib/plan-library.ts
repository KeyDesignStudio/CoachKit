export function isPlanLibraryEnabled(): boolean {
  const raw = process.env.ENABLE_PLAN_LIBRARY;
  if (!raw) return false;

  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}
