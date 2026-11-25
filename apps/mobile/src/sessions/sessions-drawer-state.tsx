import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

export type TSessionsDrawerState = { open: boolean; setOpen: (open: boolean) => void }

const SessionsDrawerContext = createContext<TSessionsDrawerState | null>(null)

export const SessionsDrawerProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ open, setOpen }), [open])
  return <SessionsDrawerContext.Provider value={value}>{children}</SessionsDrawerContext.Provider>
}

export const useSessionsDrawer = (): TSessionsDrawerState => {
  const state = useContext(SessionsDrawerContext)
  if (state === null) throw new Error('useSessionsDrawer needs a SessionsDrawerProvider above it')
  return state
}
