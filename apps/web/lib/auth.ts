import { auth, currentUser } from '@clerk/nextjs/server';
import { UserRole } from '@prisma/client';
import { cookies } from 'next/headers';

import { prisma } from '@/lib/prisma';
import { ApiError, forbidden, notFound, unauthorized } from '@/lib/errors';

type AuthenticatedContext = {
  user: {
    id: string;
    role: UserRole;
    email: string;
    name: string | null;
    timezone: string;
    authProviderId: string;
  };
};

function isAuthDisabled() {
  return (
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true')
  );
}

function getRoleCookie(): UserRole {
  try {
    const value = cookies().get('coachkit-role')?.value;
    if (value === 'ATHLETE') return UserRole.ATHLETE;
    if (value === 'COACH') return UserRole.COACH;
    if (value === 'ADMIN') return UserRole.ADMIN;
  } catch {
    // no-op: cookies() not available in all server contexts
  }

  return UserRole.COACH;
}

async function getDevUserContext(role: UserRole): Promise<AuthenticatedContext> {
  const preferredId =
    role === UserRole.ATHLETE
      ? 'dev-athlete'
      : role === UserRole.COACH
        ? 'dev-coach'
        : role === UserRole.ADMIN
          ? 'dev-admin'
          : null;

  const user = await prisma.user.findFirst({
    where: {
      role,
      ...(preferredId ? { id: preferredId } : {}),
    },
    select: {
      id: true,
      role: true,
      email: true,
      name: true,
      timezone: true,
      authProviderId: true,
    },
  });

  const fallbackUser =
    user ??
    (await prisma.user.findFirst({
      where: { role },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        role: true,
        email: true,
        name: true,
        timezone: true,
        authProviderId: true,
      },
    }));

  if (fallbackUser) {
    return {
      user: {
        id: fallbackUser.id,
        role: fallbackUser.role,
        email: fallbackUser.email,
        name: fallbackUser.name,
        timezone: fallbackUser.timezone,
        authProviderId: fallbackUser.authProviderId ?? `dev-${role.toLowerCase()}`,
      },
    };
  }

  // Dev-only escape hatch: create a minimal user so downstream DB writes don't violate FKs.
  // This runs only when auth is disabled (development) and no user exists for the role.
  const devId = preferredId ?? `dev-${role.toLowerCase()}`;
  const created = await prisma.user.create({
    data: {
      id: devId,
      email: `${devId}@local`,
      name: null,
      role,
      timezone: 'UTC',
      authProviderId: devId,
    },
    select: {
      id: true,
      role: true,
      email: true,
      name: true,
      timezone: true,
      authProviderId: true,
    },
  });

  return {
    user: {
      id: created.id,
      role: created.role,
      email: created.email,
      name: created.name,
      timezone: created.timezone,
      authProviderId: created.authProviderId ?? devId,
    },
  };
}

/**
 * Require authentication and return the authenticated user context
 * 
 * This replaces the old x-user-id header approach with proper Clerk authentication.
 * 
 * Security:
 * - Validates Clerk authentication token
 * - Looks up user in database by authProviderId
 * - Syncs authProviderId on first login if needed (invite-only)
 * - Throws unauthorized if not authenticated or user not found
 */
export async function requireAuth(): Promise<AuthenticatedContext> {
  if (isAuthDisabled()) {
    return getDevUserContext(getRoleCookie());
  }

  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    throw unauthorized('Authentication required.');
  }

  // Look up user by Clerk ID first
  let user = await prisma.user.findUnique({
    where: { authProviderId: clerkUserId },
    select: {
      id: true,
      role: true,
      email: true,
      name: true,
      timezone: true,
      authProviderId: true,
    },
  });

  // If not found by authProviderId, try to link by email (first-time login)
  if (!user) {
    const clerkUser = await currentUser();
    if (!clerkUser?.emailAddresses?.[0]?.emailAddress) {
      throw unauthorized('No email address found in authentication.');
    }

    const email = clerkUser.emailAddresses[0].emailAddress;

    // Try to find user by email
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        email: true,
        name: true,
        timezone: true,
        authProviderId: true,
      },
    });

    if (!existingUser) {
      // User authenticated with Clerk but not in our DB = not invited
      throw forbidden('Access denied. This is an invite-only platform.');
    }

    if (existingUser.authProviderId && existingUser.authProviderId !== clerkUserId) {
      // Email exists but linked to different Clerk account - security risk
      throw forbidden('Account mismatch detected. Please contact support.');
    }

    // Link the Clerk user to our DB user
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: { authProviderId: clerkUserId },
      select: {
        id: true,
        role: true,
        email: true,
        name: true,
        timezone: true,
        authProviderId: true,
      },
    });

    console.log(`[Auth] Linked Clerk user ${clerkUserId} to DB user ${user.email}`);
  }

  // At this point, authProviderId must be set
  if (!user.authProviderId) {
    throw new Error('Database inconsistency: authProviderId is null after linking');
  }

  return {
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      authProviderId: user.authProviderId,
    },
  };
}

/**
 * Require COACH role
 */
export async function requireCoach() {
  if (isAuthDisabled()) {
    // Keep existing behavior for most dev flows; allow ADMINs to function as coaches.
    const role = getRoleCookie();
    if (role === UserRole.ADMIN) return getDevUserContext(UserRole.ADMIN);
    return getDevUserContext(UserRole.COACH);
  }

  const context = await requireAuth();

  if (context.user.role !== UserRole.COACH && context.user.role !== UserRole.ADMIN) {
    throw forbidden('Coach access required.');
  }

  return context;
}

/**
 * Require ADMIN role
 */
export async function requireAdmin() {
  if (isAuthDisabled()) {
    const role = getRoleCookie();
    if (role !== UserRole.ADMIN) {
      throw forbidden('Admin access required.');
    }
    return getDevUserContext(UserRole.ADMIN);
  }

  const context = await requireAuth();

  if (context.user.role !== UserRole.ADMIN) {
    throw forbidden('Admin access required.');
  }

  return context;
}

/**
 * Require ATHLETE role
 */
export async function requireAthlete() {
  if (isAuthDisabled()) {
    return getDevUserContext(UserRole.ATHLETE);
  }

  const context = await requireAuth();

  if (context.user.role !== UserRole.ATHLETE) {
    throw forbidden('Athlete access required.');
  }

  return context;
}

/**
 * Verify a coach owns/manages a specific athlete
 */
export async function assertCoachOwnsAthlete(athleteId: string, coachId: string) {
  if (!athleteId) {
    throw new ApiError(400, 'INVALID_ATHLETE_ID', 'athleteId is required.');
  }

  const athlete = await prisma.athleteProfile.findFirst({
    where: { userId: athleteId, coachId },
    include: {
      user: true,
    },
  });

  if (!athlete) {
    throw notFound('Athlete not found for this coach.');
  }

  return athlete;
}
