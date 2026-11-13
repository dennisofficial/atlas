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

export const OPERATOR_INPUT_TOOL = 'operator_input'
export const OPERATOR_SHELL_INPUT_TOOL = 'operator_shell_input'
export const OPERATOR_TOOL_NAMES: readonly string[] = [
  OPERATOR_INPUT_TOOL,
  OPERATOR_SHELL_INPUT_TOOL,
]

export const OPERATOR_INPUT_ASKED = 'operator-input-asked'
export const OPERATOR_INPUT_SETTLED = 'operator-input-settled'
export const INBOX_KIND_OPERATOR_ANSWER = 'operator-answer'

export const operatorAnswerPayloadSchema = z.strictObject({ callId: z.string().min(1) })

export const operatorRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(EOperatorRequestKind.Input),
    prompt: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal(EOperatorRequestKind.Shell),
    prompt: z.string().min(1),
    shellId: z.string().min(1),
  }),
])

export type OperatorRequest = z.output<typeof operatorRequestSchema>

export const operatorOutcomeSchema = z.strictObject({
  outcome: z.enum(EOperatorRequestOutcome),
  path: z.string().min(1).optional(),
  bytes: z.number().int().min(0).optional(),
  reason: z.string().min(1).optional(),
})

export type OperatorOutcome = z.output<typeof operatorOutcomeSchema>

export type OperatorInputAsked = {
  type: typeof OPERATOR_INPUT_ASKED
  requestId: string
  kind: EOperatorRequestKind
  prompt: string
  shellId?: string | undefined
  expiresAt?: string | undefined
  secret?: boolean | undefined
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
  shellId: z.string().min(1).optional(),
  expiresAt: z.string().min(1).optional(),
  secret: z.boolean().optional(),
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

export const legacyOperatorEvents = [operatorInputAskedSchema, operatorInputSettledSchema] as const

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

export const parkedTextOf = (): string =>
  'the answer arrives as the result of this call, which stays open until the operator answers or cancels.'
