import type { Event, V2Event } from '@dltech/atlas-core'
import { useCallback, useMemo, useState } from 'react'

import {
  answerOperatorRequest,
  type OperatorAnswerApi,
  type OperatorAnswerBody,
} from './operator-answer'
import {
  EAnswerPhase,
  operatorAnswerViewOf,
  type OperatorAnswerState,
  type PendingOperatorAnswer,
} from './operator-answer-view'

export type OperatorRequestControl = {
  request: PendingOperatorAnswer | null
  sending: boolean
  error: string | undefined
  handleAnswer: (value: string) => void
  handleDecline: () => void
}

export const useOperatorRequest = (args: {
  api: OperatorAnswerApi | undefined
  sessionId: string
  events: readonly (Event | V2Event)[]
}): OperatorRequestControl => {
  const { api, sessionId, events } = args
  const [answer, setAnswer] = useState<OperatorAnswerState | null>(null)
  const view = useMemo(() => operatorAnswerViewOf({ events, answer }), [events, answer])
  const callId = view.request?.callId

  const answerWith = useCallback(
    (body: OperatorAnswerBody) => {
      if (api === undefined) return
      setAnswer({ callId: body.callId, phase: EAnswerPhase.Sending })
      void answerOperatorRequest({ api, body }).then((result) => {
        setAnswer(
          result.ok
            ? { callId: body.callId, phase: EAnswerPhase.Sent }
            : { callId: body.callId, phase: EAnswerPhase.Failed, error: result.reason },
        )
      })
    },
    [api],
  )

  const handleAnswer = useCallback(
    (value: string) => {
      if (callId === undefined) return
      answerWith({ sessionId, callId, value })
    },
    [answerWith, sessionId, callId],
  )

  const handleDecline = useCallback(() => {
    if (callId === undefined) return
    answerWith({ sessionId, callId, cancel: true })
  }, [answerWith, sessionId, callId])

  return { ...view, handleAnswer, handleDecline }
}
