import { auth } from '@clerk/nextjs/server';
import { cache } from 'react';

import { requireAuth } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth-user';
import { DEFAULT_BRANDING, type BrandingPayload } from '@/lib/branding';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export type AppShellBootstrap = {
  authUser: AuthUser | null;
  clerkUserId: string | null;
  branding: BrandingPayload;
  unreadNotificationsCount: number;
};

function isAuthDisabled() {
  return (
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true')
  );
}

function toAuthUser(user: Awaited<ReturnType<typeof requireAuth>>['user']): AuthUser {
  return {
    userId: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
  };
}

async function getOptionalAuthenticatedUser(): Promise<{
  authUser: AuthUser | null;
  clerkUserId: string | null;
}> {
  if (isAuthDisabled()) {
    try {
      const { user } = await requireAuth();
      return {
        authUser: toAuthUser(user),
        clerkUserId: null,
      };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return { authUser: null, clerkUserId: null };
      }
      throw error;
    }
  }

  const { userId } = await auth();
  if (!userId) {
    return { authUser: null, clerkUserId: null };
  }

  try {
    const { user } = await requireAuth();
    return {
      authUser: toAuthUser(user),
      clerkUserId: userId,
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return { authUser: null, clerkUserId: userId };
    }
    throw error;
  }
}

async function getBrandingForUser(user: AuthUser): Promise<BrandingPayload> {
  let coachId: string | null = null;

  if (user.role === 'COACH' || user.role === 'ADMIN') {
    coachId = user.userId;
  } else {
    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.userId },
      select: { coachId: true },
    });
    coachId = athleteProfile?.coachId ?? null;
  }

  if (!coachId) {
    return DEFAULT_BRANDING;
  }

  const branding = await prisma.coachBranding.findUnique({
    where: { coachId },
    select: {
      coachId: true,
      displayName: true,
      logoUrl: true,
      darkLogoUrl: true,
    },
  });

  if (!branding) {
    return { ...DEFAULT_BRANDING, coachId };
  }

  return branding;
}

async function getUnreadNotificationsCount(user: AuthUser): Promise<number> {
  if (user.role === 'COACH') {
    const unreadMessages = await prisma.message.findMany({
      where: {
        deletedAt: null,
        senderRole: 'ATHLETE',
        coachReadAt: null,
        thread: { coachId: user.userId },
      },
      select: {
        senderUserId: true,
        thread: { select: { athleteId: true } },
      },
    });

    return unreadMessages.filter((message) => message.senderUserId === message.thread.athleteId).length;
  }

  if (user.role === 'ATHLETE') {
    return prisma.message.count({
      where: {
        deletedAt: null,
        senderRole: 'COACH',
        athleteReadAt: null,
        thread: { athleteId: user.userId },
      },
    });
  }

  return 0;
}

export const getAppShellBootstrap = cache(async (): Promise<AppShellBootstrap> => {
  const { authUser, clerkUserId } = await getOptionalAuthenticatedUser();

  if (!authUser) {
    return {
      authUser: null,
      clerkUserId,
      branding: DEFAULT_BRANDING,
      unreadNotificationsCount: 0,
    };
  }

  const [branding, unreadNotificationsCount] = await Promise.all([
    getBrandingForUser(authUser),
    getUnreadNotificationsCount(authUser),
  ]);

  return {
    authUser,
    clerkUserId,
    branding,
    unreadNotificationsCount,
  };
});
