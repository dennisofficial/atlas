import { useMemo } from 'react'
import { toast } from 'sonner'

import { pendingMessagesOf, type PendingInputsState } from '@dltech/atlas-core'

import { messageOf } from '@/features/threads/data/use-send'

import {
  queuedMediaHashesOf,
  queuedNoticesOf,
  stagedQueuedOf,
  visibleQueuedOf,
  type StagedMessage,
} from './queued-messages'
import { sessionsApi } from './sessions-api'
import { useMediaUrls } from './use-media-urls'
import { EWithdrawOutcome, withdrawQueued } from './withdraw-queued'

export function useQueuedDock(args: {
  sessionId: string
  pending: PendingInputsState
  queueStaged: readonly StagedMessage[]
  transcriptStaged: readonly StagedMessage[]
  draft: string
  onDraftChange: (draft: string) => void
}) {
  const { sessionId, pending, queueStaged, transcriptStaged, draft, onDraftChange } = args
  const pendingInputs = useMemo(() => pendingMessagesOf(pending), [pending])
  const hashes = useMemo(
    () => queuedMediaHashesOf({ pending, staged: [...queueStaged, ...transcriptStaged] }),
    [pending, queueStaged, transcriptStaged],
  )
  const urls = useMediaUrls({ sessionId, hashes })
  const notices = useMemo(() => queuedNoticesOf(pending), [pending])
  const queued = useMemo(() => visibleQueuedOf({ pending, urls }), [pending, urls])
  const staged = useMemo(() => stagedQueuedOf({ staged: queueStaged, urls }), [queueStaged, urls])
  const transcriptEntries = useMemo(
    () => stagedQueuedOf({ staged: transcriptStaged, urls }),
    [transcriptStaged, urls],
  )
  const entries = useMemo(() => [...queued, ...staged], [queued, staged])
  const stagedIds = useMemo(() => new Set(staged.map((entry) => entry.id)), [staged])
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
    if (id !== undefined && withdrawIds.has(id)) void withdraw({ id, restoreText: true })
  }
  const handleRemove = (id: string) => {
    if (withdrawIds.has(id)) void withdraw({ id, restoreText: false })
  }

  return { entries, notices, stagedIds, transcriptEntries, handleEdit, handleRemove }
}
