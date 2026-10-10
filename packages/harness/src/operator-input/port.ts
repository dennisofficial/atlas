import type { ThreadId } from '@dltech/atlas-core'

export type OperatorInputPending = {
  requestId: string
  description: string
  url?: string | undefined
  path: string
}

export type OperatorInputAnswerOutcome =
  | { ok: true; bytes: number }
  | { ok: false; reason: string }

export type OperatorInputRequestArgs = OperatorInputPending & {
  threadId: ThreadId
  cwd: string
  shellId?: string | undefined
  appendNewline: boolean
  signal: AbortSignal
}

export abstract class OperatorInputPort {
  abstract request(args: OperatorInputRequestArgs): Promise<OperatorInputAnswerOutcome>

  abstract answer(args: {
    requestId: string
    value: string
    threadId?: ThreadId | undefined
  }): Promise<OperatorInputAnswerOutcome>

  abstract pending(args: { threadId: ThreadId }): OperatorInputPending | null
}
