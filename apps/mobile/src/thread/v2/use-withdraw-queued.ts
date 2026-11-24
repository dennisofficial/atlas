import type { Attachment, PendingInputsState } from '@dltech/atlas-core'
import { EWithdrawRefusal } from '@dltech/atlas-protocol'
import { useCallback } from 'react'

import { useAuth } from '../../auth/auth-provider'

export type QueuedWithdrawActions = {
  edit: (inboxId: string) => void
  remove: (inboxId: string) => void
}

export const useWithdrawQueued = (args: {
  sessionId: string
  pending: PendingInputsState
  onRefused: (notice: string) => void
  onRestore: (restored: { text: string; attachments: readonly Attachment[] }) => void
}): QueuedWithdrawActions => {
  const { api } = useAuth()
  const { sessionId, pending, onRefused, onRestore } = args

  const withdraw = useCallback(
    async (queued: { inboxId: string; restoreText: boolean }) => {
      if (api === undefined) return
      const inboxId = Number(queued.inboxId)
      const input = pending.pending.find((entry) => entry.inboxId === inboxId)
      try {
        const result = await api.sessions.withdraw.mutate({ sessionId, inboxId })
        if (!result.ok) {
          onRefused(
            result.reason === EWithdrawRefusal.AlreadyConsumed
              ? 'Already sent'
              : 'That message is no longer queued',
          )
          return
        }
        if (!queued.restoreText) return
        onRestore({
          text: input?.message?.text ?? '',
          attachments: input?.message?.attachments ?? [],
        })
      } catch {
        onRefused('That message could not be withdrawn')
      }
    },
    [api, sessionId, pending, onRefused, onRestore],
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
