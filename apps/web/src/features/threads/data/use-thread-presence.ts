'use client'

import { useEffect, useRef } from 'react'

import { reportPresence } from './threads-api'

export const PRESENCE_HEARTBEAT_MS = 25_000

const isWatchingPage = (): boolean => document.visibilityState === 'visible' && document.hasFocus()

export function useThreadPresence(args: { threadId: string; enabled: boolean }): void {
  const { threadId, enabled } = args
  const clientId = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    if (!enabled || threadId.length === 0) return undefined
    const id = clientId.current
    let timer: ReturnType<typeof setInterval> | undefined
    let watching: boolean | undefined

    const send = (next: string | null) => {
      void reportPresence({ clientId: id, threadId: next }).catch(() => undefined)
    }

    const sync = () => {
      const next = isWatchingPage()
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
      if (next) {
        timer = setInterval(() => {
          if (isWatchingPage()) send(threadId)
          else sync()
        }, PRESENCE_HEARTBEAT_MS)
      }
      if (next === watching) return
      watching = next
      send(next ? threadId : null)
    }

    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      if (timer !== undefined) clearInterval(timer)
      send(null)
    }
  }, [enabled, threadId])
}
