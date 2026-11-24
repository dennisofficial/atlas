import { useMemo } from 'react'
import { toast } from 'sonner'

import { pendingMessagesOf, type Attachment, type PendingInputsState } from '@dltech/atlas-core'
import { queuedMessagesOf } from '@dltech/atlas-client/session'
import {
  optimisticPlacementOf,
  transcriptEventsOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import type { TranscriptRow } from '@/features/threads/data/transcript-items'
import { mediaUrls } from '@/features/threads/data/media-urls'
import { messageOf } from '@/features/threads/data/use-send'

import { sessionEventTypes } from '../registered-plugins'
import { queuedMediaHashesOf, type StagedMessage } from './queued-messages'
import { optimisticQueuedRowsOf, optimisticUserItemsOf, queuedRowsOf } from './queued-transcript'
import { sessionsApi } from './sessions-api'
import { useMediaUrls } from './use-media-urls'
import { EWithdrawOutcome, withdrawQueued } from './withdraw-queued'

export function useQueuedTranscript(args: {
  sessionId: string
  pending: PendingInputsState
  events: SessionSnapshot['events']
  staged: readonly StagedMessage[]
  items: readonly TranscriptRow[]
  draft: string
  onDraftChange: (draft: string) => void
  onRestoreAttachments: (restored: {
    attachments: readonly Attachment[]
    previewOf: (hash: string) => Promise<string>
  }) => void
}) {
  const { sessionId, pending, events, staged, items: listed, draft } = args
  const { onDraftChange, onRestoreAttachments } = args
  const pendingInputs = useMemo(() => pendingMessagesOf(pending), [pending])
  const hashes = useMemo(() => queuedMediaHashesOf({ pending, staged }), [pending, staged])
  const urls = useMediaUrls({ sessionId, hashes })
  const placement = useMemo(
    () => optimisticPlacementOf({ staged, events, pending }),
    [staged, events, pending],
  )
  const transcriptEvents = useMemo(() => transcriptEventsOf(events, sessionEventTypes), [events])
  const rows = useMemo(
    () => [
      ...queuedRowsOf({
        pending,
        events: transcriptEvents,
        urls,
        hiddenInboxIds: placement.hiddenInboxIds,
      }),
      ...optimisticQueuedRowsOf({ staged: placement.queue, urls }),
    ],
    [pending, transcriptEvents, urls, placement],
  )
  const items = useMemo(() => optimisticUserItemsOf(placement.transcript), [placement])
  const transcript = useMemo(() => [...listed, ...items], [listed, items])
  const queued = useMemo(() => queuedMessagesOf(pending), [pending])
  const withdrawIds = useMemo(
    () => new Set(pendingInputs.map((input) => String(input.inboxId))),
    [pendingInputs],
  )

  const withdraw = async (params: { id: string; restoreText: boolean }) => {
    const entry = queued.find((candidate) => candidate.id === params.id)
    if (entry === undefined) return
    try {
      const result = await withdrawQueued({
        api: sessionsApi,
        sessionId,
        inboxId: Number(entry.id),
        text: entry.text,
        attachments: entry.attachments,
        draft,
        restoreText: params.restoreText,
      })
      if (result.outcome === EWithdrawOutcome.Refused) {
        toast(result.notice)
        return
      }
      onDraftChange(result.draft)
      if (result.attachments.length === 0) return
      onRestoreAttachments({
        attachments: result.attachments,
        previewOf: (hash) => mediaUrls.urlOf({ sessionId, hash }),
      })
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
