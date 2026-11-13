import { z } from 'zod'

import { EReportKind } from '../agents/report'
import { EAgentRestart } from '../agents/restart'
import { EAgentStart } from '../agents/start'
import { EAgentStatus } from '../agents/status'
import { EKilledBy } from '../shells/status'
import { EModelFallbackReason } from './agent-body'
import { threadIdSchema } from './ids'
import { ERunFailureKind } from './run-failure'
import { noticeStampSchema } from './notice-stamp-schema'

export const agentEventSchemas = [
  z.object({
    type: z.literal('agent-spawned'),
    agentId: threadIdSchema,
    agentType: z.string().min(1),
    intent: z.string(),
    mode: z.enum(EAgentStart),
    worktree: z
      .object({
        path: z.string(),
        branch: z.string(),
        base: z.string().optional(),
        adopted: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('agent-ended'),
    agentId: threadIdSchema,
    agentType: z.string().min(1),
    intent: z.string(),
    status: z.enum(EAgentStatus),
    killedBy: z.enum(EKilledBy).optional(),
    failureCause: z.string().optional(),
    failureKind: z.enum(ERunFailureKind).catch(ERunFailureKind.Other).optional(),
    prose: z.string(),
    turns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    relayed: z.boolean().optional(),
    leftServices: z.array(z.string()).optional(),
    notice: noticeStampSchema.optional(),
  }),
  z.object({
    type: z.literal('agent-restarted'),
    agentId: threadIdSchema,
    agentType: z.string().min(1),
    intent: z.string(),
    via: z.enum(EAgentRestart),
  }),
  z.object({
    type: z.literal('agent-reported'),
    agentId: threadIdSchema,
    agentType: z.string().min(1),
    intent: z.string(),
    prose: z.string(),
    kind: z.enum(EReportKind).optional(),
    notice: noticeStampSchema.optional(),
  }),
  z.object({
    type: z.literal('model-fell-back'),
    role: z.string().min(1),
    agentId: threadIdSchema.optional(),
    from: z.object({ ref: z.string().min(1), label: z.string().min(1) }),
    to: z.object({ ref: z.string().min(1), label: z.string().min(1) }),
    reason: z.enum(EModelFallbackReason),
  }),
] as const
