import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';

import {
  AI_PLAN_BUILDER_ADMIN_EMAILS_ENV,
  isAiPlanBuilderAuditAdminUser,
  parseAiPlanBuilderAdminEmailsFromEnv,
} from '@/modules/ai-plan-builder/server/audit-admin';

describe('AI Plan Builder v1 (Tranche 11A: admin audit access)', () => {
  it('admin role is allowed', () => {
    const env = { [AI_PLAN_BUILDER_ADMIN_EMAILS_ENV]: '' } as NodeJS.ProcessEnv;
    expect(isAiPlanBuilderAuditAdminUser({ role: UserRole.ADMIN, email: 'x@example.com' }, env)).toBe(true);
  });

  it('listed admin email is allowed', () => {
    const env = { [AI_PLAN_BUILDER_ADMIN_EMAILS_ENV]: 'admin@example.com, other@example.com' } as NodeJS.ProcessEnv;
    expect(isAiPlanBuilderAuditAdminUser({ role: UserRole.COACH, email: 'Admin@Example.com' }, env)).toBe(true);
  });

  it('non-admin is blocked when not listed', () => {
    const env = { [AI_PLAN_BUILDER_ADMIN_EMAILS_ENV]: 'admin@example.com' } as NodeJS.ProcessEnv;
    expect(isAiPlanBuilderAuditAdminUser({ role: UserRole.COACH, email: 'nope@example.com' }, env)).toBe(false);
  });

  it('parses env list defensively', () => {
    const env = { [AI_PLAN_BUILDER_ADMIN_EMAILS_ENV]: ' , A@b.com,  ,c@d.com ' } as NodeJS.ProcessEnv;
    const set = parseAiPlanBuilderAdminEmailsFromEnv(env);
    expect(set.has('a@b.com')).toBe(true);
    expect(set.has('c@d.com')).toBe(true);
    expect(set.has('')).toBe(false);
  });
});
