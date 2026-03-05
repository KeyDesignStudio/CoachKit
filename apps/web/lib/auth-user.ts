import type { UserRole } from '@prisma/client';

export type AuthUser = {
  userId: string;
  role: UserRole;
  email: string;
  name: string | null;
  timezone: string;
};
