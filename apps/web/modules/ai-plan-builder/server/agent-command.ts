import { z } from 'zod';

import { ApiError } from '@/lib/errors';

const baseCommandSchema = z.object({
  scope: z.enum(['set', 'session', 'week', 'plan']),
  commandType: z.enum([
    'ADJUST_WEEK_LOAD',
    'MOVE_SESSION',
    'SWAP_DISCIPLINE_DAY',
    'REWRITE_SESSION_DETAIL',
    'INSERT_RECOVERY_BLOCK',
    'ADAPT_FOR_CONSTRAINT',
  ]),
});

const commandPayloadSchema = z.object({
  // Shared selectors.
  weekIndex: z.number().int().min(0).max(52).optional(),
  fromWeekIndex: z.number().int().min(0).max(52).optional(),
  toWeekIndex: z.number().int().min(0).max(52).optional(),
  sessionId: z.string().min(1).optional(),
  // Load and scheduling controls.
  pctDelta: z.number().min(-0.9).max(1).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  fromDayOfWeek: z.number().int().min(0).max(6).optional(),
  toDayOfWeek: z.number().int().min(0).max(6).optional(),
  discipline: z.string().trim().min(1).max(32).optional(),
  // Session rewrite controls.
  setType: z.enum(['warmup', 'main', 'cooldown']).optional(),
  text: z.string().trim().min(1).max(1_000).optional(),
  type: z.string().trim().min(1).max(64).optional(),
  durationMinutes: z.number().int().min(0).max(10_000).optional(),
  notes: z.string().max(10_000).nullable().optional(),
  objective: z.string().trim().max(240).optional(),
  // Constraint adaptation.
  constraint: z.string().trim().min(1).max(1_000).optional(),
  guidance: z.string().trim().min(1).max(2_000).optional(),
});

export const agentCommandSchema = baseCommandSchema.extend({
  payload: commandPayloadSchema.default({}),
});

export const legacyAgentAdjustRequestSchema = z
  .object({
    draftPlanId: z.string().min(1),
    scope: z.enum(['session', 'week', 'plan']).optional(),
    instruction: z.string().min(3).max(2_000).optional(),
    weekIndex: z.number().int().min(0).max(52).optional(),
    sessionId: z.string().min(1).optional(),
    command: agentCommandSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const scope = value.command?.scope ?? value.scope;
    const instruction = value.instruction?.trim();

    if (!scope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope'],
        message: 'scope is required.',
      });
      return;
    }

    if (!value.command && !instruction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instruction'],
        message: 'instruction is required when command is not provided.',
      });
    }

    if (scope === 'week' && value.weekIndex == null && value.command?.payload.weekIndex == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekIndex'],
        message: 'weekIndex is required for week scope.',
      });
    }

    if ((scope === 'session' || scope === 'set') && !value.sessionId && !value.command?.payload.sessionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sessionId'],
        message: 'sessionId is required for session/set scope.',
      });
    }
  });

export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type ParsedAgentAdjustRequest = {
  draftPlanId: string;
  scope: 'set' | 'session' | 'week' | 'plan';
  instruction: string;
  weekIndex?: number;
  sessionId?: string;
  command: AgentCommand | null;
};

function dayLabel(day: number | undefined) {
  if (!Number.isInteger(day)) return null;
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return labels[Number(day)] ?? null;
}

function buildInstructionFromCommand(command: AgentCommand): string {
  const payload = command.payload ?? {};

  if (command.commandType === 'ADJUST_WEEK_LOAD') {
    const pct = Number(payload.pctDelta ?? 0);
    const pctText = `${pct >= 0 ? '+' : ''}${Math.round(pct * 100)}%`;
    return `Adjust week load ${pctText}.`;
  }

  if (command.commandType === 'MOVE_SESSION') {
    const toDay = dayLabel(payload.dayOfWeek);
    return toDay ? `Move this session to ${toDay}.` : 'Move this session to a different day.';
  }

  if (command.commandType === 'SWAP_DISCIPLINE_DAY') {
    const fromDay = dayLabel(payload.fromDayOfWeek);
    const toDay = dayLabel(payload.toDayOfWeek);
    const discipline = payload.discipline ? String(payload.discipline).toLowerCase() : 'discipline';
    if (fromDay && toDay) return `Swap ${discipline} from ${fromDay} to ${toDay}.`;
    return `Swap ${discipline} to a different day.`;
  }

  if (command.commandType === 'REWRITE_SESSION_DETAIL') {
    const lines: string[] = [];
    if (payload.setType && payload.text) {
      lines.push(`${payload.setType}: ${payload.text}`);
    }
    if (payload.type) lines.push(`type: ${payload.type}`);
    if (Number.isFinite(Number(payload.durationMinutes))) lines.push(`duration: ${Math.round(Number(payload.durationMinutes))} min`);
    if (payload.objective) lines.push(`objective: ${payload.objective}`);
    if (payload.notes !== undefined && payload.notes !== null) lines.push(`notes: ${String(payload.notes)}`);
    return lines.join('\n').trim() || 'Refine this session detail while preserving intent and safety.';
  }

  if (command.commandType === 'INSERT_RECOVERY_BLOCK') {
    const from = Number(payload.fromWeekIndex);
    const to = Number(payload.toWeekIndex);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      return `Insert a recovery block from week ${Math.round(from)} to week ${Math.round(to)}.`;
    }
    return 'Insert a recovery block to reduce fatigue and preserve consistency.';
  }

  if (command.commandType === 'ADAPT_FOR_CONSTRAINT') {
    const parts = [payload.constraint, payload.guidance].filter(Boolean).map((v) => String(v).trim());
    if (parts.length) return `Adapt plan for constraint: ${parts.join('. ')}`;
    return 'Adapt this plan for current life constraints while preserving key sessions.';
  }

  return 'Adjust this draft plan safely while preserving progression intent.';
}

export function parseAgentAdjustRequest(rawBody: unknown): ParsedAgentAdjustRequest {
  const parsed = legacyAgentAdjustRequestSchema.parse(rawBody);
  const command = parsed.command ?? null;
  const scope = command?.scope ?? (parsed.scope as ParsedAgentAdjustRequest['scope']);

  const payloadWeekIndex = command?.payload.weekIndex;
  const payloadSessionId = command?.payload.sessionId;
  const weekIndex = parsed.weekIndex ?? payloadWeekIndex;
  const sessionId = parsed.sessionId ?? payloadSessionId;

  const instruction = command ? buildInstructionFromCommand(command) : String(parsed.instruction ?? '').trim();

  if (!instruction) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Instruction could not be derived from command payload.');
  }

  if (scope === 'week' && weekIndex == null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'weekIndex is required for week scope.');
  }
  if ((scope === 'session' || scope === 'set') && !sessionId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'sessionId is required for session/set scope.');
  }

  return {
    draftPlanId: parsed.draftPlanId,
    scope,
    instruction,
    weekIndex: weekIndex ?? undefined,
    sessionId: sessionId ?? undefined,
    command,
  };
}
