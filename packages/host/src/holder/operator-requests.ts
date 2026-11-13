import type { EOperatorRequestOutcome } from '@dltech/atlas-plugin-operator/core'
import type { PodOperatorAsk } from '@dltech/atlas-plugin-sdk'

export type OperatorRequestOpen = { requestId: string }

export type OperatorRequestSettle = {
  requestId: string
  outcome: EOperatorRequestOutcome
  at?: Date | undefined
}

export type OperatorAnswer = { ok: true; value: string } | { ok: false; cancel: true }

export type OperatorDeliveryResult = { ok: true } | { ok: false; reason: string }

export type OperatorAnswerHandoff = {
  take(requestId: string): OperatorAnswer | undefined
  resolve(args: { requestId: string; result: OperatorDeliveryResult }): void
}

export type OperatorRequestPort = {
  open(args: {
    sessionId: string
    threadId: string
    ask: PodOperatorAsk
  }): Promise<OperatorRequestOpen>
  settle(args: OperatorRequestSettle): Promise<boolean>
  answers: OperatorAnswerHandoff
}
