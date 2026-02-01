import { UserRole } from '@prisma/client';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

import type { AiCapabilityName } from '../ai/audit';
import { guardAiPlanBuilderRequest } from './guard';
import type { AiInvocationActorType } from './llm-rate-limit';

export const AI_PLAN_BUILDER_ADMIN_EMAILS_ENV = 'AI_PLAN_BUILDER_ADMIN_EMAILS' as const;

export function parseAiPlanBuilderAdminEmailsFromEnv(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const raw = env[AI_PLAN_BUILDER_ADMIN_EMAILS_ENV];
  if (!raw) return new Set();

  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAiPlanBuilderAuditAdminUser(
  user: { role: UserRole; email: string },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (user.role === UserRole.ADMIN) return true;

  const emails = parseAiPlanBuilderAdminEmailsFromEnv(env);
  return emails.has(String(user.email).trim().toLowerCase());
}

export async function requireAiPlanBuilderAuditAdminUser(): Promise<{ id: string; role: UserRole; email: string }> {
  guardAiPlanBuilderRequest();

  const user = await (async () => {
    try {
      const ctx = await requireAuth();
      return ctx.user;
    } catch {
      // 404-by-default: avoid leaking admin route existence.
      throw notFound('Not found.');
    }
  })();

  if (!isAiPlanBuilderAuditAdminUser(user)) {
    throw notFound('Not found.');
  }

  return { id: user.id, role: user.role, email: user.email };
}

const RANGE_PRESET = z.enum(['24h', '7d', '30d']);

export type AiAuditListQuery = {
  range: z.infer<typeof RANGE_PRESET>;
  since: Date;
  until: Date;
  capability?: AiCapabilityName;
  fallbackUsed?: boolean;
  errorCode?: string;
  actorType?: AiInvocationActorType;
  limit: number;
  offset: number;
};

export function maskPotentiallySensitiveId(value: string): string {
  const v = String(value);
  if (!v) return '';

  if (v.includes('@')) {
    const [local, domain] = v.split('@');
    if (!domain) return '***';
    const visible = local.length <= 2 ? local[0] ?? '' : local.slice(0, 2);
    return `${visible}***@${domain}`;
  }

  if (v.length <= 10) return v;
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function normalizeAiAuditListQuery(params: {
  searchParams: Record<string, string | string[] | undefined>;
  now?: Date;
}): AiAuditListQuery {
  const now = params.now ?? new Date();
  const sp = params.searchParams;

  const get = (key: string) => {
    const v = sp[key];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const range = RANGE_PRESET.catch('24h').parse(get('range'));

  const limit = Math.max(1, Math.min(200, Number(get('limit') ?? '50') || 50));
  const offset = Math.max(0, Number(get('offset') ?? '0') || 0);

  const untilRaw = get('until');
  const sinceRaw = get('since');

  const until = untilRaw ? new Date(untilRaw) : now;

  const ms =
    range === '24h' ? 24 * 60 * 60 * 1000 : range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const since = sinceRaw ? new Date(sinceRaw) : new Date(until.getTime() - ms);

  const capability = (get('capability') || '').trim() as AiCapabilityName;
  const capabilityAllowed: ReadonlySet<AiCapabilityName> = new Set([
    'summarizeIntake',
    'suggestDraftPlan',
    'suggestProposalDiffs',
    'generateSessionDetail',
  ]);

  const fallbackUsedRaw = (get('fallbackUsed') || '').trim().toLowerCase();
  const fallbackUsed = fallbackUsedRaw === 'true' ? true : fallbackUsedRaw === 'false' ? false : undefined;

  const actorTypeRaw = (get('actorType') || '').trim().toUpperCase();
  const actorTypeAllowed: ReadonlySet<AiInvocationActorType> = new Set(['COACH', 'ATHLETE', 'SYSTEM']);

  const errorCode = (get('errorCode') || '').trim();

  return {
    range,
    since,
    until,
    capability: capabilityAllowed.has(capability) ? capability : undefined,
    fallbackUsed,
    errorCode: errorCode.length ? errorCode : undefined,
    actorType: actorTypeAllowed.has(actorTypeRaw as any) ? (actorTypeRaw as AiInvocationActorType) : undefined,
    limit,
    offset,
  };
}

export async function listAiInvocationAuditsForAdmin(params: {
  query: AiAuditListQuery;
  requester: { role: UserRole; email: string };
}): Promise<{
  items: Array<{
    id: string;
    createdAt: Date;
    capability: string;
    effectiveMode: string;
    provider: string;
    model: string | null;
    durationMs: number;
    maxOutputTokens: number | null;
    retryCount: number;
    fallbackUsed: boolean;
    errorCode: string | null;
    actorType: string;
    actorId: string;
    actorIdDisplay: string;
  }>;
  page: { limit: number; offset: number; hasPrev: boolean; hasNext: boolean };
}> {
  guardAiPlanBuilderRequest();
  if (!isAiPlanBuilderAuditAdminUser(params.requester)) throw notFound('Not found.');

  const { query } = params;

  const where: any = {
    createdAt: {
      gte: query.since,
      lt: query.until,
    },
    ...(query.capability ? { capability: query.capability } : {}),
    ...(query.fallbackUsed === undefined ? {} : { fallbackUsed: query.fallbackUsed }),
    ...(query.errorCode ? { errorCode: query.errorCode } : {}),
    ...(query.actorType ? { actorType: query.actorType as any } : {}),
  };

  const rows = await prisma.aiInvocationAudit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: query.offset,
    take: query.limit,
    select: {
      id: true,
      createdAt: true,
      capability: true,
      effectiveMode: true,
      provider: true,
      model: true,
      durationMs: true,
      maxOutputTokens: true,
      retryCount: true,
      fallbackUsed: true,
      errorCode: true,
      actorType: true,
      actorId: true,
    },
  });

  const hasPrev = query.offset > 0;
  const hasNext = rows.length === query.limit;

  return {
    items: rows.map((r) => ({
      ...r,
      actorIdDisplay: maskPotentiallySensitiveId(r.actorId),
    })),
    page: { limit: query.limit, offset: query.offset, hasPrev, hasNext },
  };
}

export async function getAiInvocationAuditForAdmin(params: {
  id: string;
  requester: { role: UserRole; email: string };
}): Promise<{
  id: string;
  actorType: string;
  actorId: string;
  actorIdDisplay: string;
  coachId: string | null;
  athleteId: string | null;
  capability: string;
  specVersion: string;
  effectiveMode: string;
  provider: string;
  model: string | null;
  inputHash: string;
  outputHash: string;
  durationMs: number;
  maxOutputTokens: number | null;
  timeoutMs: number | null;
  retryCount: number;
  fallbackUsed: boolean;
  errorCode: string | null;
  createdAt: Date;
}> {
  guardAiPlanBuilderRequest();
  if (!isAiPlanBuilderAuditAdminUser(params.requester)) throw notFound('Not found.');

  const row = await prisma.aiInvocationAudit.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      actorType: true,
      actorId: true,
      coachId: true,
      athleteId: true,
      capability: true,
      specVersion: true,
      effectiveMode: true,
      provider: true,
      model: true,
      inputHash: true,
      outputHash: true,
      durationMs: true,
      maxOutputTokens: true,
      timeoutMs: true,
      retryCount: true,
      fallbackUsed: true,
      errorCode: true,
      createdAt: true,
    },
  });

  if (!row) throw notFound('Not found.');

  return { ...row, actorIdDisplay: maskPotentiallySensitiveId(row.actorId) };
}
