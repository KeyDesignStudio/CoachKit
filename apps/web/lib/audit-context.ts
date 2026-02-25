import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserRole } from '@prisma/client';

export type AuditActor = {
  userId: string;
  email: string;
  role: UserRole;
};

const auditActorStorage = new AsyncLocalStorage<AuditActor>();

export function setAuditActor(actor: AuditActor) {
  auditActorStorage.enterWith(actor);
}

export function getAuditActor(): AuditActor | null {
  return auditActorStorage.getStore() ?? null;
}
