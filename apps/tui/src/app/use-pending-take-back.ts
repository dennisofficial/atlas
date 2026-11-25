import type { Attachment, PendingInputsState, RecordEvent } from '@dltech/atlas-core'
import { pendingMessagesOf } from '@dltech/atlas-core'
import { requestWithdraw, withdrawStore, type WithdrawIntent } from '@dltech/atlas-client/session'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import type { ComposerRestore } from './composer-restore'
import type { DraftControls } from '../ui/hooks/use-draft'
import type { SessionApi } from './session-api'

export type TakeBack = {
  handleTakeBack: () => boolean
  canTakeBack: boolean
  hiddenInboxIds: ReadonlySet<number>
}

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const NO_IDS: ReadonlySet<number> = new Set()

const NO_INTENTS: readonly WithdrawIntent[] = []

export type TakeBackTarget = {
  targetInboxId: number
  text: string
  attachments: readonly Attachment[]
}

export const takeBackOf = (pending: PendingInputsState): TakeBackTarget | undefined => {
  const lastQueued = pendingMessagesOf(pending).at(-1)
  if (lastQueued === undefined) return undefined
  return {
    targetInboxId: lastQueued.inboxId,
    text: lastQueued.message?.text ?? '',
    attachments: lastQueued.message?.attachments ?? [],
  }
}

export function usePendingTakeBack(args: {
  api: SessionApi
  sessionId: string | null
  pending: PendingInputsState
  foldable: readonly RecordEvent[]
  draft: DraftControls
  restore: ComposerRestore
  onProblem: (reason: string) => void
}): TakeBack {
  const { sessionId } = args
  const latest = useRef(args)
  latest.current = args

  const subscribe = useCallback(
    (listener: () => void) =>
      sessionId === null ? () => undefined : withdrawStore.subscribe({ sessionId, listener }),
    [sessionId],
  )
  const getIntents = useCallback(
    () => (sessionId === null ? NO_INTENTS : withdrawStore.intentsOf(sessionId)),
    [sessionId],
  )
  const intents = useSyncExternalStore(subscribe, getIntents, getIntents)
  const hiddenInboxIds = useMemo(
    () => (intents.length === 0 ? NO_IDS : new Set(intents.map((entry) => entry.targetInboxId))),
    [intents],
  )

  useEffect(() => {
    if (sessionId === null) return
    const settled = withdrawStore.takeSettlements({ sessionId, events: args.foldable })
    for (const entry of settled) {
      if (entry.status === 'refused') latest.current.onProblem(entry.notice)
    }
  }, [sessionId, args.foldable])

  const handleTakeBack = useCallback((): boolean => {
    const current = latest.current
    if (current.sessionId === null) return false
    const target = takeBackOf(current.pending)
    if (target === undefined) return false
    const intent: WithdrawIntent = {
      sessionId: current.sessionId,
      targetInboxId: target.targetInboxId,
    }
    if (!withdrawStore.request(intent)) return true
    current.restore({
      text: mergeWithdrawnIntoDraft({ withdrawn: target.text, draft: current.draft.value }),
      attachments: target.attachments,
      reason: undefined,
    })
    void requestWithdraw({
      api: current.api,
      sessionId: intent.sessionId,
      targetInboxId: intent.targetInboxId,
    })
      .then((outcome) => {
        if (outcome.accepted) return
        withdrawStore.discard(intent)
        latest.current.onProblem(outcome.notice)
      })
      .catch((failure: unknown) => {
        withdrawStore.discard(intent)
        latest.current.onProblem(messageOf(failure))
      })
    return true
  }, [])

  return {
    handleTakeBack,
    canTakeBack: pendingMessagesOf(args.pending).length > 0,
    hiddenInboxIds,
  }
}
