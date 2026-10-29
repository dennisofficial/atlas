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

export function useThreadArchive(args: {
  entries: readonly ProjectThreads[] | undefined
  reload: () => void
  onArchived: (threadId: string) => void
  archive: (args: { threadId: string; archived: boolean }) => Promise<unknown>
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

  const handleToggleArchive = useCallback(
    async (thread: WireThread) => {
      const archived = thread.archivedAt === null || thread.archivedAt === undefined
      const threadId = thread.id
      const archivedAt = archived ? new Date().toISOString() : null
      setOverrides((current) => withOverride({ overrides: current, threadId, archivedAt }))
      try {
        await archive({ threadId, archived })
        if (archived) onArchived(threadId)
        reload()
      } catch {
        setOverrides((current) => withoutOverride({ overrides: current, threadId }))
        toast.error(archived ? "Couldn't archive the thread" : "Couldn't restore the thread")
      }
    },
    [reload, onArchived, archive],
  )

  return { entries: shown, handleToggleArchive }
}
