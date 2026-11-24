import {
  withdrawRefusalNoticeOf,
  withdrawStepOf,
  type WithdrawRequest,
} from '@dltech/atlas-client/session'
import type { PendingInputsState, V2Event } from '@dltech/atlas-core'
import { pendingMessagesOf } from '@dltech/atlas-core'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { DraftControls } from '../ui/hooks/use-draft'
import type { DraftTokens } from '../ui/hooks/use-draft-tokens'
import type { SessionApi } from './session-api'
import type { StagedState } from './staged-messages'

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
  events: readonly V2Event[]
  draft: DraftControls
  tokens: Pick<DraftTokens, 'restore'>
  onProblem: (reason: string) => void
}): TakeBack {
  const latest = useRef(args)
  latest.current = args
  const inFlight = useRef(false)
  const [requests, setRequests] = useState<readonly WithdrawRequest[]>([])
  const handled = useRef<ReadonlySet<number>>(new Set())

  const putBack = useCallback((text: string) => {
    const { draft, tokens } = latest.current
    tokens.restore({
      text: mergeWithdrawnIntoDraft({ withdrawn: text, draft: draft.value }),
      images: [],
    })
  }, [])

  useEffect(() => {
    if (requests.length === 0) return
    const step = withdrawStepOf({ requests, handled: handled.current, events: args.events })
    if (step.handled === handled.current) return
    handled.current = step.handled
    setRequests((current) => current.filter((entry) => !step.handled.has(entry.targetInboxId)))
    if (step.restore !== undefined) putBack(step.restore.text)
    if (step.notices.length > 0) latest.current.onProblem(step.notices.join('\n'))
  }, [args.events, putBack, requests])

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

    const targetInboxId = lastQueued.inboxId
    inFlight.current = true
    void current.api
      .withdraw({ sessionId: current.sessionId, inboxId: targetInboxId })
      .then((result) => {
        if (!result.ok) {
          latest.current.onProblem(withdrawRefusalNoticeOf(result.reason))
          return
        }
        setRequests((held) => [
          ...held,
          {
            targetInboxId,
            restoreText: true,
            text: lastQueued.message?.text ?? '',
            attachments: lastQueued.message?.attachments ?? [],
          },
        ])
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
