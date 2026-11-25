import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import type { Attachment, PendingInputsState } from '@dltech/atlas-core'
import { withdrawOwnedInboxIdsOf, withdrawStore } from '@dltech/atlas-client/session'
import {
  EStagedOutcome,
  stagedOutcomesOf,
  stagedWithdrawOwnedIdsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import { mergeWithdrawnIntoDraft, type StagedMessage } from './queued-messages'
import { settleMessages, stageMessage, stagedOf, subscribeStaged } from './staged-store'

export type StagedDraft = StagedMessage & { attachments: readonly Attachment[] }

export function useStagedMessages(args: {
  sessionId: string
  events: SessionSnapshot['events']
  pending: PendingInputsState
  draft: string
  onDraftChange: (draft: string) => void
  onRestoreAttachments: (attachments: readonly Attachment[]) => void
}) {
  const { sessionId, events, pending, draft, onDraftChange } = args
  const subscribe = useCallback(
    (listener: () => void) => subscribeStaged({ sessionId, listener }),
    [sessionId],
  )
  const getSnapshot = useCallback(() => stagedOf(sessionId), [sessionId])
  const staged = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const withdrawSubscribe = useCallback(
    (listener: () => void) => withdrawStore.subscribe({ sessionId, listener }),
    [sessionId],
  )
  const getIntents = useCallback(() => withdrawStore.intentsOf(sessionId), [sessionId])
  const intents = useSyncExternalStore(withdrawSubscribe, getIntents, getIntents)
  const handled = useRef<ReadonlySet<string>>(new Set())
  const draftRef = useRef(draft)
  draftRef.current = draft
  const changeRef = useRef(onDraftChange)
  changeRef.current = onDraftChange
  const restoreAttachments = useRef(args.onRestoreAttachments)
  restoreAttachments.current = args.onRestoreAttachments

  const stage = useCallback(
    (message: StagedDraft) => stageMessage({ sessionId, message }),
    [sessionId],
  )

  const outcomes = useMemo(
    () => stagedOutcomesOf({ events, clientIds: staged.map((entry) => entry.clientId) }),
    [events, staged],
  )
  const unread = useMemo(
    () =>
      new Set(
        pending.pending.flatMap((input) =>
          input.message?.clientId === undefined ? [] : [input.message.clientId],
        ),
      ),
    [pending],
  )

  useEffect(() => {
    if (staged.length === 0) return
    const owned = stagedWithdrawOwnedIdsOf({
      events,
      clientIds: staged.map((entry) => entry.clientId),
      ownedInboxIds: withdrawOwnedInboxIdsOf({ events, intents }),
    })
    const settled = staged.flatMap((entry) => {
      const outcome = outcomes.get(entry.clientId)
      if (outcome === undefined || outcome.outcome === EStagedOutcome.Pending) return []
      if (outcome.outcome === EStagedOutcome.Posted && unread.has(entry.clientId)) return []
      return [{ entry, outcome }]
    })
    if (settled.length === 0) return
    const texts: string[] = []
    const attachments: Attachment[] = []
    for (const { entry, outcome } of settled) {
      if (handled.current.has(entry.clientId)) continue
      handled.current = new Set([...handled.current, entry.clientId])
      if (owned.has(entry.clientId)) continue
      if (outcome.outcome === EStagedOutcome.Discarded) {
        texts.push(entry.text)
        attachments.push(...entry.attachments)
        continue
      }
      if (outcome.outcome !== EStagedOutcome.Refused) continue
      if (outcome.reason === 'already-sent') {
        toast.error('Already sent')
        continue
      }
      texts.push(entry.text)
      if (outcome.reason !== undefined) toast.error(outcome.reason)
    }
    if (texts.length > 0) {
      changeRef.current(
        texts.reduceRight(
          (draftText, text) => mergeWithdrawnIntoDraft({ withdrawn: text, draft: draftText }),
          draftRef.current,
        ),
      )
    }
    if (attachments.length > 0) restoreAttachments.current(attachments)
    settleMessages({
      sessionId,
      clientIds: new Set(settled.map(({ entry }) => entry.clientId)),
    })
  }, [events, intents, outcomes, unread, sessionId, staged])

  return { staged, stage }
}
