import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

/**
 * GET /api/me - Returns the authenticated user's database record
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
