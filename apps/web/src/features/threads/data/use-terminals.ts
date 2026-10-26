'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { createTerminalSet, type TerminalChannel, type TerminalSet } from './terminal-session-set'

const EMPTY_VIEW = { tabs: [], activeId: '', epoch: 0 } as const

const NEVER_SUBSCRIBED = () => () => undefined

export function useTerminals(args: { channel: TerminalChannel | null; connected: boolean }): {
  set: TerminalSet | null
  view: ReturnType<TerminalSet['view']>
} {
  const { channel, connected } = args
  const [set, setSet] = useState<TerminalSet | null>(null)

  useEffect(() => {
    if (channel === null) return
    const created = createTerminalSet({ channel })
    setSet(created)
    return () => {
      created.dispose()
      setSet(null)
    }
  }, [channel])

  useEffect(() => {
    if (set === null) return
    if (connected) set.resume()
    else set.suspend()
  }, [set, connected])

  const view = useSyncExternalStore(
    set?.subscribe ?? NEVER_SUBSCRIBED,
    () => set?.view() ?? EMPTY_VIEW,
    () => EMPTY_VIEW,
  )
  return { set, view }
}
