'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import type { AppThread } from './fixtures/app'

type PendingThreadSetter = (thread: AppThread | undefined) => void

const PendingThreadContext = createContext<AppThread | undefined>(undefined)
const PendingThreadSetterContext = createContext<PendingThreadSetter>(() => undefined)

export function PendingThreadProvider({ children }: { children: ReactNode }) {
  const [thread, setThread] = useState<AppThread | undefined>(undefined)
  return (
    <PendingThreadSetterContext.Provider value={setThread}>
      <PendingThreadContext.Provider value={thread}>{children}</PendingThreadContext.Provider>
    </PendingThreadSetterContext.Provider>
  )
}

export function usePendingThread(): AppThread | undefined {
  return useContext(PendingThreadContext)
}

export function useRegisterPendingThread(thread: AppThread | undefined): void {
  const setThread = useContext(PendingThreadSetterContext)
  useEffect(() => {
    setThread(thread)
    return () => setThread(undefined)
  }, [thread, setThread])
}
