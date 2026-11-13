import { z } from 'zod'

export enum EOperatorRequestKind {
  Input = 'input',
  Shell = 'shell',
}

export enum EOperatorRequestOutcome {
  Delivered = 'delivered',
  Cancelled = 'cancelled',
  Abandoned = 'abandoned',
  Expired = 'expired',
  Failed = 'failed',
}

export const OPERATOR_INPUT_ASKED = 'operator-input-asked'
export const OPERATOR_INPUT_SETTLED = 'operator-input-settled'
export const INBOX_KIND_OPERATOR_ANSWER = 'operator-answer'

export type OperatorInputAsked = {
  type: typeof OPERATOR_INPUT_ASKED
  requestId: string
  kind: EOperatorRequestKind
  prompt: string
  secret: boolean
  shellId?: string | undefined
  expiresAt?: string | undefined
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
  expiresAt: z.string().min(1).optional(),
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

export const deliveredTextOf = (args: {
  kind: EOperatorRequestKind
  path?: string | undefined
  shellId?: string | undefined
  bytes: number
}): string =>
  args.kind === EOperatorRequestKind.Shell
    ? `the operator's value was typed into the stdin of shell ${args.shellId ?? ''} (${args.bytes} bytes). Read the shell's output to see what the CLI did with it.`
    : `the operator's value was written to ${args.path ?? ''} (${args.bytes} bytes, mode 0600). Read it from there and never paste it into a message.`

export const refusalTextOf = (reason: string): string =>
  `the operator did not deliver a value: ${reason}. No value arrived, so nothing was written or typed; ask again with a fresh request if the value is still needed.`

export const parkedTextOf = (requestId: string): string =>
  `request ${requestId} is open; its answer arrives as this call's result and the turn ends here until the operator answers or cancels.`
