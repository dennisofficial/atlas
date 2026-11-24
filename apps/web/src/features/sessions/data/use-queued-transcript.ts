import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { pendingMessagesOf, type Attachment, type PendingInputsState } from '@dltech/atlas-core'
import {
  queuedMessagesOf,
  withdrawStepOf,
  type WithdrawRequest,
} from '@dltech/atlas-client/session'
import {
  optimisticPlacementOf,
  transcriptEventsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import type { SessionNameOf, TranscriptRow } from '@/features/threads/data/transcript-items'
import { mediaUrls } from '@/features/threads/data/media-urls'
import { messageOf } from '@/features/threads/data/use-send'

import { sessionEventTypes } from '../registered-plugins'
import { mergeWithdrawnIntoDraft, type StagedMessage } from './queued-messages'
import { optimisticUserItemsOf, queuedRowsOf } from './queued-transcript'
import { EWithdrawOutcome, requestWithdraw, type WithdrawApi } from './withdraw-queued'

export function useQueuedTranscript(args: {
  api: WithdrawApi
  sessionId: string
  pending: PendingInputsState
  events: SessionSnapshot['events']
  staged: readonly StagedMessage[]
  items: readonly TranscriptRow[]
  sessionNameOf?: SessionNameOf | undefined
  draft: string
  onDraftChange: (draft: string) => void
  onRestoreAttachments: (restored: {
    attachments: readonly Attachment[]
    previewOf: (hash: string) => Promise<string>
  }) => void
}) {
  const { api, sessionId, pending, events, staged, items: listed, draft } = args
  const { onDraftChange, onRestoreAttachments, sessionNameOf } = args
  const pendingInputs = useMemo(() => pendingMessagesOf(pending), [pending])
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
        hiddenInboxIds: placement.hiddenInboxIds,
        ...(sessionNameOf === undefined ? {} : { sessionNameOf }),
      }),
    [pending, transcriptEvents, placement, sessionNameOf],
  )
  const items = useMemo(() => optimisticUserItemsOf(placement.transcript), [placement])
  const transcript = useMemo(() => [...listed, ...items], [listed, items])
  const queued = useMemo(() => queuedMessagesOf(pending), [pending])
  const withdrawIds = useMemo(
    () => new Set(pendingInputs.map((input) => String(input.inboxId))),
    [pendingInputs],
  )
  const [requests, setRequests] = useState<readonly WithdrawRequest[]>([])
  const handled = useRef<ReadonlySet<number>>(new Set())
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    if (requests.length === 0) return
    const step = withdrawStepOf({ requests, handled: handled.current, events })
    if (step.handled === handled.current) return
    handled.current = step.handled
    setRequests((current) => current.filter((entry) => !step.handled.has(entry.targetInboxId)))
    if (step.restore !== undefined) {
      onDraftChange(
        mergeWithdrawnIntoDraft({ withdrawn: step.restore.text, draft: draftRef.current }),
      )
      if (step.restore.attachments.length > 0)
        onRestoreAttachments({
          attachments: step.restore.attachments,
          previewOf: (hash) => mediaUrls.urlOf({ sessionId, hash }),
        })
    }
    for (const notice of step.notices) toast(notice)
  }, [requests, events, onDraftChange, onRestoreAttachments, sessionId])

  const withdraw = async (params: { id: string; restoreText: boolean }) => {
    const entry = queued.find((candidate) => candidate.id === params.id)
    if (entry === undefined) return
    const targetInboxId = Number(entry.id)
    try {
      const result = await requestWithdraw({ api, sessionId, inboxId: targetInboxId })
      if (result.outcome === EWithdrawOutcome.Refused) {
        toast(result.notice)
        return
      }
      setRequests((current) => [
        ...current,
        {
          targetInboxId,
          restoreText: params.restoreText,
          text: entry.text,
          attachments: entry.attachments,
        },
      ])
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  const handleEdit = (inboxId: string) => {
    if (withdrawIds.has(inboxId)) void withdraw({ id: inboxId, restoreText: true })
  }
  const handleRemove = (inboxId: string) => {
    if (withdrawIds.has(inboxId)) void withdraw({ id: inboxId, restoreText: false })
  }

  return {
    transcript,
    queued: { rows, onEdit: handleEdit, onRemove: handleRemove },
  }
}
