import type { PendingInputsState } from '@dltech/atlas-core'
import { pendingMessagesOf } from '@dltech/atlas-core'
import { EWithdrawRefusal } from '@dltech/atlas-protocol'
import { useCallback, useRef } from 'react'

import type { DraftControls } from '../ui/hooks/use-draft'
import type { DraftTokens } from '../ui/hooks/use-draft-tokens'
import type { SessionApi } from './session-api'
import type { StagedState } from './staged-messages'

export const ALREADY_SENT_NOTICE = 'Already sent'

export const WITHDRAW_UNKNOWN_NOTICE = 'That message is no longer queued'

export type TakeBack = {
  handleTakeBack: () => boolean
  canTakeBack: boolean
}

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function usePendingTakeBack(args: {
  api: SessionApi
  sessionId: string | null
  pending: PendingInputsState
  staged: StagedState
  draft: DraftControls
  tokens: Pick<DraftTokens, 'restore'>
  onProblem: (reason: string) => void
}): TakeBack {
  const latest = useRef(args)
  latest.current = args
  const inFlight = useRef(false)

  const putBack = useCallback((text: string) => {
    const { draft, tokens } = latest.current
    tokens.restore({
      text: mergeWithdrawnIntoDraft({ withdrawn: text, draft: draft.value }),
      images: [],
    })
  }, [])

  const handleTakeBack = useCallback((): boolean => {
    if (inFlight.current) return true
    const current = latest.current
    if (current.sessionId === null) return false

    const lastStaged = current.staged.staged.at(-1)
    if (lastStaged !== undefined) {
      current.staged.withdraw(lastStaged.clientId)
      putBack(lastStaged.text)
      return true
    }

    const lastQueued = pendingMessagesOf(current.pending).at(-1)
    if (lastQueued === undefined) return false

    inFlight.current = true
    void current.api
      .withdraw({ sessionId: current.sessionId, inboxId: lastQueued.inboxId })
      .then((result) => {
        if (result.ok) {
          putBack(lastQueued.message?.text ?? '')
          return
        }
        latest.current.onProblem(
          result.reason === EWithdrawRefusal.AlreadyConsumed
            ? ALREADY_SENT_NOTICE
            : WITHDRAW_UNKNOWN_NOTICE,
        )
      })
      .catch((failure: unknown) => {
        latest.current.onProblem(messageOf(failure))
      })
      .finally(() => {
        inFlight.current = false
      })

    return true
  }, [putBack])

  return {
    handleTakeBack,
    canTakeBack: args.staged.staged.length > 0 || pendingMessagesOf(args.pending).length > 0,
  }
}
