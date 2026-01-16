import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth';
import { AdminWorkoutLibrary } from '@/components/admin/AdminWorkoutLibrary';

export const dynamic = 'force-dynamic';

export default async function AdminWorkoutLibraryPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/access-denied?reason=forbidden');
  }

  return (
    <div
      data-testid="admin-workout-library-page"
      className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6"
    >
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-[var(--text)]">Workout Library</h1>
        <p className="text-sm text-[var(--muted)]">Admin-only CRUD + import tooling.</p>
      </div>

      <AdminWorkoutLibrary />
    </div>
  );
}
