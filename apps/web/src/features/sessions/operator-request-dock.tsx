'use client'

import type { RequestItem } from '@/features/threads/data/transcript-items'
import { OperatorInputCard } from '@/features/threads/operator-input-card'

import { useOperatorRequestAnswer } from './data/use-operator-request'

export function OperatorRequestDock({
  sessionId,
  request,
}: {
  sessionId: string
  request: RequestItem | null
}) {
  const answer = useOperatorRequestAnswer({ sessionId, request })
  if (request === null) return null
  return (
    <OperatorInputCard
      key={request.callId}
      description={request.prompt}
      submitting={answer.submitting}
      {...(answer.error === undefined ? {} : { error: answer.error })}
      onSubmit={answer.handleSubmit}
      onCancel={answer.handleCancel}
    />
  )
}
