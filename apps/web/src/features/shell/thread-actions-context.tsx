import { createContext, useContext } from 'react'

import type { WireThread } from '@dltech/atlas-wire/web'

export interface ThreadActions {
  onToggleArchive: (thread: WireThread) => void
}

export const ThreadActionsContext = createContext<ThreadActions | null>(null)

export function useThreadActions(): ThreadActions {
  const actions = useContext(ThreadActionsContext)
  if (actions === null) throw new Error('useThreadActions needs a ThreadActionsContext provider')
  return actions
}
