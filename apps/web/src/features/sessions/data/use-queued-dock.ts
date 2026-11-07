import { useMemo } from 'react'
import { toast } from 'sonner'

import type { V2Event } from '@dltech/atlas-core'
import type { SessionQueuedMessage } from '@dltech/atlas-protocol'

import { messageOf } from '@/features/threads/data/use-send'

import { queuedMediaHashesOf, visibleQueuedOf } from './queued-messages'
import { sessionsApi } from './sessions-api'
import { useMediaUrls } from './use-media-urls'
import { EWithdrawOutcome, withdrawQueued } from './withdraw-queued'

export function useQueuedDock(args: {
  sessionId: string
  queued: readonly SessionQueuedMessage[] | undefined
  events: readonly V2Event[]
  draft: string
  onDraftChange: (draft: string) => void
}) {
  const { sessionId, queued, events, draft, onDraftChange } = args
  const hashes = useMemo(() => queuedMediaHashesOf(queued), [queued])
  const urls = useMediaUrls({ sessionId, hashes })
  const entries = useMemo(() => visibleQueuedOf({ queued, events, urls }), [queued, events, urls])

  const withdraw = async (params: { id: string; restoreText: boolean }) => {
    const entry = entries.find((candidate) => candidate.id === params.id)
    if (entry === undefined) return
    try {
      const result = await withdrawQueued({
        api: sessionsApi,
        sessionId,
        inboxId: Number(entry.id),
        text: entry.text,
        draft,
        restoreText: params.restoreText,
      })
      if (result.outcome === EWithdrawOutcome.Refused) toast(result.notice)
      else onDraftChange(result.draft)
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  const handleEdit = (id: string | undefined) => {
    if (id !== undefined) void withdraw({ id, restoreText: true })
  }
  const handleRemove = (id: string) => void withdraw({ id, restoreText: false })

  return { entries, handleEdit, handleRemove }
}
