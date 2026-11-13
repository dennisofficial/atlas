import { useState } from 'react'

import {
  answerOperatorRequest,
  cancelOperatorRequest,
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
  requestId: string
  phase: EAnswerPhase
  error?: string | undefined
}

export function useOperatorRequestAnswer(request: RequestItem | null) {
  const [answer, setAnswer] = useState<AnswerState | null>(null)
  const requestId = request?.requestId
  const current = answer !== null && answer.requestId === requestId ? answer : null
  const submitting = current?.phase === 'sending' || current?.phase === 'sent'

  const send = (work: (id: string) => Promise<OperatorAnswerResult>) => {
    if (requestId === undefined) return
    setAnswer({ requestId, phase: 'sending' })
    void work(requestId).then((result) => {
      setAnswer(
        result.ok
          ? { requestId, phase: 'sent' }
          : { requestId, phase: 'failed', error: result.reason },
      )
    })
  }

  return {
    submitting,
    error: current?.phase === 'failed' ? current.error : undefined,
    handleSubmit: (value: string) => send((id) => answerOperatorRequest({ requestId: id, value })),
    handleCancel: () => send((id) => cancelOperatorRequest({ requestId: id })),
  }
}
