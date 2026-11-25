import { useEffect, useMemo, useCallback, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import type { Attachment, PendingInputsState } from '@dltech/atlas-core'
import {
  queuedMessagesOf,
  requestWithdraw,
  withdrawStore,
  type WithdrawApi,
  type WithdrawIntent,
} from '@dltech/atlas-client/session'
import {
  optimisticPlacementOf,
  transcriptEventsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import type { SessionNameOf, TranscriptRow } from '@/features/threads/data/transcript-items'
import { mediaUrls } from '@/features/threads/data/media-urls'
import { messageOf } from '@/features/threads/data/message-of'

import { sessionEventTypes } from '../registered-plugins'
import { mergeWithdrawnIntoDraft, type StagedMessage } from './queued-messages'
import { optimisticUserItemsOf, queuedRowsOf } from './queued-transcript'
import { sessionsApi } from './sessions-api'

export function useQueuedTranscript(args: {
  sessionId: string
  pending: PendingInputsState
  events: SessionSnapshot['events']
  foldable: SessionSnapshot['foldable']
  queueKnown: boolean
  staged: readonly StagedMessage[]
  items: readonly TranscriptRow[]
  sessionNameOf?: SessionNameOf | undefined
  draft: string
  onDraftChange: (draft: string) => void
  onRestoreAttachments: (restored: {
    attachments: readonly Attachment[]
    previewOf: (hash: string) => Promise<string>
  }) => void
  api?: WithdrawApi
}) {
  const { sessionId, pending, events, foldable, queueKnown, staged, items: listed, draft } = args
  const { onDraftChange, onRestoreAttachments, sessionNameOf } = args
  const api = args.api ?? sessionsApi
  const subscribe = useCallback(
    (listener: () => void) => withdrawStore.subscribe({ sessionId, listener }),
    [sessionId],
  )
  const getIntents = useCallback(() => withdrawStore.intentsOf(sessionId), [sessionId])
  const intents = useSyncExternalStore(subscribe, getIntents, getIntents)
  const hiddenInboxIds = useMemo(
    () => new Set(intents.map((intent) => intent.targetInboxId)),
    [intents],
  )
  const placement = useMemo(
    () => optimisticPlacementOf({ staged, events, pending }),
    [staged, events, pending],
  )
  const transcriptEvents = useMemo(() => transcriptEventsOf(events, sessionEventTypes), [events])
  const rows = useMemo(
    () =>
      queuedRowsOf({
        pending,
        events: transcriptEvents,
        staged: placement.queue,
        hiddenInboxIds,
        ...(sessionNameOf === undefined ? {} : { sessionNameOf }),
      }),
    [pending, transcriptEvents, placement, hiddenInboxIds, sessionNameOf],
  )
  const items = useMemo(() => optimisticUserItemsOf(placement.transcript), [placement])
  const transcript = useMemo(() => [...listed, ...items], [listed, items])
  const queued = useMemo(() => queuedMessagesOf(pending), [pending])
  const queuedInboxIds = useMemo(() => new Set(queued.map((entry) => Number(entry.id))), [queued])

  useEffect(() => {
    const settled = withdrawStore.takeSettlements({
      sessionId,
      events: foldable,
      queuedInboxIds,
      queueKnown,
    })
    for (const entry of settled) {
      if (entry.status === 'refused') toast(entry.notice)
    }
  }, [sessionId, foldable, intents, queuedInboxIds, queueKnown])

  const withdraw = async (params: { inboxId: string; restoreText: boolean }) => {
    const entry = queued.find((candidate) => candidate.id === params.inboxId)
    if (entry === undefined) return
    const intent: WithdrawIntent = { sessionId, targetInboxId: Number(entry.id) }
    const request = requestWithdraw({ api, intents: withdrawStore, intent })
    if (!request.recorded) return
    if (params.restoreText) {
      onDraftChange(mergeWithdrawnIntoDraft({ withdrawn: entry.text, draft }))
      if (entry.attachments.length > 0) {
        onRestoreAttachments({
          attachments: entry.attachments,
          previewOf: (hash) => mediaUrls.urlOf({ sessionId, hash }),
        })
      }
    }
    const outcome = await request.outcome
    if (outcome.kind === 'refused') toast(outcome.notice)
    if (outcome.kind === 'failed') toast.error(messageOf(outcome.failure))
  }

  const handleEdit = (inboxId: string) => {
    void withdraw({ inboxId, restoreText: true })
  }
  const handleRemove = (inboxId: string) => {
    void withdraw({ inboxId, restoreText: false })
  }

  return {
    transcript,
    queued: { rows, onEdit: handleEdit, onRemove: handleRemove },
  }
}
