import { createContext, useContext } from 'react'

export interface ThreadActions {
  onToggleArchive: (threadId: string) => void
}

export const ThreadActionsContext = createContext<ThreadActions | null>(null)

export function useThreadActions(): ThreadActions {
  const actions = useContext(ThreadActionsContext)
  if (actions === null) throw new Error('useThreadActions needs a ThreadActionsContext provider')
  return actions
}
