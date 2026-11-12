import { z } from 'zod'

export enum EOperatorRequestKind {
  Input = 'input',
  Shell = 'shell',
}

export enum EOperatorRequestOutcome {
  Delivered = 'delivered',
  Cancelled = 'cancelled',
  Expired = 'expired',
  Failed = 'failed',
}

export const OPERATOR_INPUT_ASKED = 'operator-input-asked'
export const OPERATOR_INPUT_SETTLED = 'operator-input-settled'

export type OperatorInputAsked = {
  type: typeof OPERATOR_INPUT_ASKED
  requestId: string
  kind: EOperatorRequestKind
  prompt: string
  secret: boolean
  shellId?: string | undefined
  expiresAt: string
  sessionId: string
}

export type OperatorInputSettled = {
  type: typeof OPERATOR_INPUT_SETTLED
  requestId: string
  outcome: EOperatorRequestOutcome
  path?: string | undefined
  bytes?: number | undefined
  reason?: string | undefined
  sessionId: string
}

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'operator-input-asked': OperatorInputAsked
    'operator-input-settled': OperatorInputSettled
  }
}

export const operatorInputAskedSchema: z.ZodType<OperatorInputAsked> = z.object({
  type: z.literal(OPERATOR_INPUT_ASKED),
  requestId: z.string().min(1),
  kind: z.enum(EOperatorRequestKind),
  prompt: z.string().min(1),
  secret: z.boolean(),
  shellId: z.string().min(1).optional(),
  expiresAt: z.string().min(1),
  sessionId: z.string().min(1),
})

export const operatorInputSettledSchema: z.ZodType<OperatorInputSettled> = z.object({
  type: z.literal(OPERATOR_INPUT_SETTLED),
  requestId: z.string().min(1),
  outcome: z.enum(EOperatorRequestOutcome),
  path: z.string().min(1).optional(),
  bytes: z.number().int().min(0).optional(),
  reason: z.string().min(1).optional(),
  sessionId: z.string().min(1),
})
