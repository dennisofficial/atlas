import type { Attachment, PendingInputsState, V2Event } from '@dltech/atlas-core'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { withdrawRefusalNoticeOf, withdrawStepOf, type WithdrawRequest } from './withdraw-queue'

export type QueuedWithdrawActions = {
  edit: (inboxId: string) => void
  remove: (inboxId: string) => void
}

export const useWithdrawQueued = (args: {
  sessionId: string
  pending: PendingInputsState
  events: readonly V2Event[]
  onRefused: (notice: string) => void
  onRestore: (restored: { text: string; attachments: readonly Attachment[] }) => void
}): QueuedWithdrawActions => {
  const { api } = useAuth()
  const { sessionId, pending, events, onRefused, onRestore } = args
  const [requests, setRequests] = useState<readonly WithdrawRequest[]>([])
  const handled = useRef<ReadonlySet<number>>(new Set())

  useEffect(() => {
    if (requests.length === 0) return
    const step = withdrawStepOf({ requests, handled: handled.current, events })
    if (step.handled === handled.current) return
    handled.current = step.handled
    setRequests((current) => current.filter((entry) => !step.handled.has(entry.targetInboxId)))
    if (step.restore !== undefined) onRestore(step.restore)
    if (step.notices.length > 0) onRefused(step.notices.join('\n'))
  }, [requests, events, onRestore, onRefused])

  const withdraw = useCallback(
    async (queued: { inboxId: string; restoreText: boolean }) => {
      if (api === undefined) return
      const targetInboxId = Number(queued.inboxId)
      const input = pending.pending.find((entry) => entry.inboxId === targetInboxId)
      try {
        const result = await api.sessions.withdraw.mutate({ sessionId, inboxId: targetInboxId })
        if (!result.ok) {
          onRefused(withdrawRefusalNoticeOf(result.reason))
          return
        }
        setRequests((current) => [
          ...current,
          {
            targetInboxId,
            restoreText: queued.restoreText,
            text: input?.message?.text ?? '',
            attachments: input?.message?.attachments ?? [],
          },
        ])
      } catch {
        onRefused('That message could not be withdrawn')
      }
    },
    [api, sessionId, pending, onRefused],
  )

  return {
    edit: useCallback(
      (inboxId: string) => void withdraw({ inboxId, restoreText: true }),
      [withdraw],
    ),
    remove: useCallback(
      (inboxId: string) => void withdraw({ inboxId, restoreText: false }),
      [withdraw],
    ),
  }
}
