import { usePathname } from 'expo-router'
import { useState } from 'react'

import { useAuth } from '../auth/auth-provider'
import { applyNavigation } from '../navigation/apply-navigation'
import { archiveOutcomeOf } from './archive-action'
import type { ISessionEntry } from './session-groups'
import { selectedSessionStore, useSelectedSession } from './selected-session'
import type { TSetArchiveOverride } from './use-sessions'

export type THandleArchive = (args: { entry: ISessionEntry; archived: boolean }) => Promise<void>

export const useArchiveSession = ({
  setArchiveOverride,
  refresh,
}: {
  setArchiveOverride: TSetArchiveOverride
  refresh: () => Promise<void>
}): { handleArchive: THandleArchive; failure: string | null } => {
  const { api } = useAuth()
  const pathname = usePathname()
  const selectedId = useSelectedSession()
  const [failure, setFailure] = useState<string | null>(null)

  const handleArchive: THandleArchive = async ({ entry, archived }) => {
    if (api === undefined) return
    setFailure(null)
    setArchiveOverride({
      sessionId: entry.id,
      archivedAt: archived ? new Date().toISOString() : null,
    })
    try {
      await api.sessions.archive.mutate({ sessionId: entry.id, archived })
    } catch {
      setArchiveOverride({ sessionId: entry.id, archivedAt: undefined })
      setFailure(`Could not ${archived ? 'archive' : 'unarchive'} ${entry.title}.`)
      return
    }
    if (archived) {
      const outcome = archiveOutcomeOf({ archivedId: entry.id, selectedId, pathname })
      if (outcome.deselect) selectedSessionStore().select(null)
      applyNavigation(outcome.navigation)
    }
    await refresh()
  }

  return { handleArchive, failure }
}
