import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { WireThread } from '@dltech/atlas-wire/web'

import {
  applyArchiveOverrides,
  settleArchiveOverrides,
  type ArchiveOverrides,
} from './archive-overrides'
import type { ProjectThreads } from './thread-partition'

const NO_OVERRIDES: ArchiveOverrides = new Map()
export const UNDO_ARCHIVE_MS = 8000

const withOverride = (args: {
  overrides: ArchiveOverrides
  threadId: string
  archivedAt: string | null
}): ArchiveOverrides => new Map(args.overrides).set(args.threadId, args.archivedAt)

const withoutOverride = (args: { overrides: ArchiveOverrides; threadId: string }) => {
  const next = new Map(args.overrides)
  next.delete(args.threadId)
  return next
}

type AfterUndo = () => void

export function useThreadArchive(args: {
  entries: readonly ProjectThreads[] | undefined
  reload: () => void
  onArchived: (threadId: string) => AfterUndo | undefined
  archive: (args: {
    threadId: string
    archived: boolean
    runner?: WireThread['runner']
  }) => Promise<unknown>
}) {
  const { entries, reload, onArchived, archive } = args
  const [overrides, setOverrides] = useState<ArchiveOverrides>(NO_OVERRIDES)

  const settled = entries === undefined ? overrides : settleArchiveOverrides({ entries, overrides })
  if (settled !== overrides) setOverrides(settled)

  const shown = useMemo(
    () =>
      entries === undefined || overrides.size === 0
        ? entries
        : applyArchiveOverrides({ entries, overrides }),
    [entries, overrides],
  )

  const persist = useCallback(
    async (persistArgs: { thread: WireThread; archived: boolean }) => {
      const { thread, archived } = persistArgs
      const threadId = thread.id
      const archivedAt = archived ? new Date().toISOString() : null
      setOverrides((current) => withOverride({ overrides: current, threadId, archivedAt }))
      try {
        await archive({ threadId, archived, runner: thread.runner })
        reload()
        return true
      } catch {
        setOverrides((current) => withoutOverride({ overrides: current, threadId }))
        toast.error(archived ? "Couldn't archive the thread" : "Couldn't restore the thread")
        return false
      }
    },
    [reload, archive],
  )

  const handleToggleArchive = useCallback(
    async (thread: WireThread) => {
      const archived = thread.archivedAt === null || thread.archivedAt === undefined
      if (!(await persist({ thread, archived })) || !archived) return
      const afterUndo = onArchived(thread.id)
      const handleUndo = async () => {
        if (await persist({ thread, archived: false })) afterUndo?.()
      }
      toast('Thread archived', {
        description: thread.title,
        duration: UNDO_ARCHIVE_MS,
        action: { label: 'Undo', onClick: () => void handleUndo() },
      })
    },
    [persist, onArchived],
  )

  return { entries: shown, handleToggleArchive }
}
