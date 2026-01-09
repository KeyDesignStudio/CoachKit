import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

// Force dynamic rendering (required for auth)
export const dynamic = 'force-dynamic';

/**
 * GET /api/me - Returns the authenticated user's database record
 * 
 * Status codes:
 * - 200: User authenticated and found in DB (invited)
 * - 401: Not authenticated with Clerk
 * - 403: Authenticated but not invited (not in DB)
 * - 500: Server error
 */
export async function GET() {
  try {
    const { user } = await requireAuth();
    
    return success({ 
      user: {
        userId: user.id,
        role: user.role,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
      }
    });
  } catch (error) {
    return handleError(error);
  }
}
