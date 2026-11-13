import { useState } from 'react'

import {
  answerOperatorRequest,
  cancelOperatorRequest,
  type OperatorAnswerKey,
  type OperatorAnswerResult,
} from '@/features/threads/data/operator-answer'
import {
  ETranscriptKind,
  type RequestItem,
  type TranscriptRow,
} from '@/features/threads/data/transcript-items'

export const pendingOperatorRequestOf = (items: readonly TranscriptRow[]): RequestItem | null =>
  items.find(
    (item): item is RequestItem =>
      item.kind === ETranscriptKind.Request && item.state === 'pending',
  ) ?? null

type EAnswerPhase = 'sending' | 'sent' | 'failed'

type AnswerState = {
  callId: string
  phase: EAnswerPhase
  error?: string | undefined
}

export type OperatorRequestAnswerArgs = {
  sessionId: string
  request: RequestItem | null
}

export function useOperatorRequestAnswer(args: OperatorRequestAnswerArgs) {
  const [answer, setAnswer] = useState<AnswerState | null>(null)
  const callId = args.request?.callId
  const current = answer !== null && answer.callId === callId ? answer : null
  const submitting = current?.phase === 'sending' || current?.phase === 'sent'

  const send = (work: (key: OperatorAnswerKey) => Promise<OperatorAnswerResult>) => {
    if (callId === undefined) return
    setAnswer({ callId, phase: 'sending' })
    void work({ sessionId: args.sessionId, callId }).then((result) => {
      setAnswer(
        result.ok ? { callId, phase: 'sent' } : { callId, phase: 'failed', error: result.reason },
      )
    })
  }

  return {
    submitting,
    error: current?.phase === 'failed' ? current.error : undefined,
    handleSubmit: (value: string) => send((key) => answerOperatorRequest({ ...key, value })),
    handleCancel: () => send((key) => cancelOperatorRequest(key)),
  }
}
