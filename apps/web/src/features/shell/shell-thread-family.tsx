'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

import type { WireThread } from '@dltech/atlas-wire/web'

const ThreadFamilyContext = createContext<readonly WireThread[]>([])

export function ThreadFamilyProvider({
  threads,
  children,
}: {
  threads: readonly WireThread[]
  children: ReactNode
}) {
  const inherited = useThreadFamily()
  const family = useMemo(
    () => [...new Map([...inherited, ...threads].map((thread) => [thread.id, thread])).values()],
    [inherited, threads],
  )
  return <ThreadFamilyContext.Provider value={family}>{children}</ThreadFamilyContext.Provider>
}

export function useThreadFamily(): readonly WireThread[] {
  return useContext(ThreadFamilyContext)
}
