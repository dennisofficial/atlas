export type OperatorAnswerKey = { sessionId: string; callId: string }

export type OperatorAnswer = { ok: true; value: string } | { ok: false; cancel: true }

export type OperatorDeliveryResult = { ok: true } | { ok: false; reason: string }

export type OperatorAnswerHandoff = {
  take(key: OperatorAnswerKey): OperatorAnswer | undefined
  resolve(args: { key: OperatorAnswerKey; result: OperatorDeliveryResult }): void
}

export type OperatorRequestPort = { answers: OperatorAnswerHandoff }
