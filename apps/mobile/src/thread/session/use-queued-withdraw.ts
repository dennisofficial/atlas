import type { ApiClient } from '@dltech/atlas-api-router'
import type { PendingInputsState, RecordEvent } from '@dltech/atlas-core'
import { requestWithdraw, withdrawStore, type WithdrawApi } from '@dltech/atlas-client/session'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { queuedWithdrawPlanOf, withdrawalNoticesOf, type QueuedRestore } from './withdraw-queued'
import './withdraw-persistence'

export type QueuedWithdraw = {
  hiddenInboxIds: ReadonlySet<number>
  edit: (inboxId: number) => void
  remove: (inboxId: number) => void
}

export function useQueuedWithdraw(args: {
  api: ApiClient | undefined
  sessionId: string
  pending: PendingInputsState
  foldable: readonly RecordEvent[]
  onRestore: (restored: QueuedRestore) => void
  onNotice: (notice: string) => void
}): QueuedWithdraw {
  const { api, sessionId, pending, foldable, onRestore, onNotice } = args
  const subscribe = useCallback(
    (listener: () => void) => withdrawStore.subscribe({ sessionId, listener }),
    [sessionId],
  )
  const getIntents = useCallback(() => withdrawStore.intentsOf(sessionId), [sessionId])
  const intents = useSyncExternalStore(subscribe, getIntents, getIntents)
  const hiddenInboxIds = useMemo(
    () => new Set(intents.map((entry) => entry.targetInboxId)),
    [intents],
  )

  useEffect(() => {
    const settled = withdrawStore.takeSettlements({ sessionId, events: foldable })
    const notices = withdrawalNoticesOf(settled)
    if (notices.length > 0) onNotice(notices.join('\n'))
  }, [sessionId, foldable, onNotice])

  const withdraw = useCallback(
    async (params: { inboxId: number; restoreText: boolean }) => {
      if (api === undefined) return
      const plan = queuedWithdrawPlanOf({
        sessionId,
        pending,
        inboxId: params.inboxId,
        restoreText: params.restoreText,
      })
      if (plan === undefined) return
      if (!withdrawStore.request(plan.intent)) return
      if (plan.restore !== undefined) onRestore(plan.restore)
      const withdrawApi: WithdrawApi = { withdraw: (input) => api.sessions.withdraw.mutate(input) }
      try {
        const outcome = await requestWithdraw({
          api: withdrawApi,
          sessionId,
          targetInboxId: plan.intent.targetInboxId,
        })
        if (outcome.accepted) return
        withdrawStore.discard(plan.intent)
        onNotice(outcome.notice)
      } catch {
        withdrawStore.discard(plan.intent)
        onNotice('The message could not be withdrawn. Try again.')
      }
    },
    [api, onNotice, onRestore, pending, sessionId],
  )

  const edit = useCallback(
    (inboxId: number) => {
      void withdraw({ inboxId, restoreText: true })
    },
    [withdraw],
  )

  const remove = useCallback(
    (inboxId: number) => {
      void withdraw({ inboxId, restoreText: false })
    },
    [withdraw],
  )

  return { hiddenInboxIds, edit, remove }
}
