import { requireAdmin } from '@/lib/auth';

export async function requireWorkoutLibraryAdmin() {
  return requireAdmin();
}
