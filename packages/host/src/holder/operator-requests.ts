import type { PodOperatorAsk } from '@dltech/atlas-plugin-sdk'

export type OperatorRequestAnswer = { ok: true; value: string } | { ok: false; reason: string }

export type OperatorRequestOpen = {
  requestId: string
  expiresAt: Date
  answered: Promise<OperatorRequestAnswer>
  abandon(reason: 'cancelled'): void
}

export type OperatorRequestPort = {
  open(args: {
    sessionId: string
    threadId: string
    ask: PodOperatorAsk
  }): Promise<OperatorRequestOpen>
}
