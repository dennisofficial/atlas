import { z } from 'zod'

import { ERiskDimension } from '../policy/classifier/dimension'
import { EGrantScope } from '../policy/classifier/grant'
import { EClassifierMode, ETriage } from '../policy/classifier/triage'
import { EJudgment, EVerdictFault } from '../policy/classifier/verdict'
import { callIdSchema } from './ids'

export const grantOfferSchema = z.object({
  subject: z.string().min(1),
  dimensions: z.array(z.enum(ERiskDimension)),
})

export const policyEventSchemas = [
  z.object({
    type: z.literal('classifier-judged'),
    callId: callIdSchema,
    mode: z.enum(EClassifierMode),
    triage: z.enum(ETriage),
    judgment: z.enum(EJudgment),
    dimensions: z.array(z.enum(ERiskDimension)),
    judgedDimension: z.enum(ERiskDimension).optional(),
    verdictFault: z.enum(EVerdictFault).optional(),
    judgeFault: z.string().optional(),
    signalIds: z.array(z.string()),
    details: z.array(z.string()).optional(),
    grantables: z.array(grantOfferSchema).optional(),
    reason: z.string(),
    consulted: z.boolean(),
    wouldAsk: z.boolean().optional(),
    elapsedMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('permission-granted'),
    grantId: z.string().min(1),
    dimensions: z.array(z.enum(ERiskDimension)),
    scope: z.enum(EGrantScope),
    subject: z.string().min(1),
    reason: z.string(),
  }),
] as const
