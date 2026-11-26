import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { usePosture } from '../layout/use-posture'
import { type TScopedOverlayState, useScopedOverlay } from '../layout/use-scoped-overlay'
import { drawerOpenByDefaultOf, drawerScopeOf } from './drawer-layout'
import { useSelectedSession } from './selected-session'

export type TSessionsDrawerState = TScopedOverlayState

const SessionsDrawerContext = createContext<TSessionsDrawerState | null>(null)

export const SessionsDrawerProvider = ({ children }: { children: ReactNode }) => {
  const { sessionsList } = usePosture()
  const selected = useSelectedSession()
  const { open, setOpen } = useScopedOverlay({
    scope: drawerScopeOf({ listLayout: sessionsList, selected }),
    openByDefault: drawerOpenByDefaultOf({ listLayout: sessionsList }),
  })
  const value = useMemo(() => ({ open, setOpen }), [open, setOpen])
  return <SessionsDrawerContext.Provider value={value}>{children}</SessionsDrawerContext.Provider>
}

export const useSessionsDrawer = (): TSessionsDrawerState => {
  const state = useContext(SessionsDrawerContext)
  if (state === null) throw new Error('useSessionsDrawer needs a SessionsDrawerProvider above it')
  return state
}
