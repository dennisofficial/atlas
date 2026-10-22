import { useEffect, useState } from 'react'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { fetchEvents, fetchHead } from './threads-api'

const POLL_MS = 1000

export type ThreadEvents = { events: WireEvent[]; loaded: boolean; error: Error | null }

const INITIAL: ThreadEvents = { events: [], loaded: false, error: null }

export function useThreadEvents(threadId: string): ThreadEvents {
  const [state, setState] = useState(INITIAL)

  useEffect(() => {
    let cancelled = false
    let lastHead: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const { head } = await fetchHead(threadId)
        if (cancelled) return
        if (head === lastHead) {
          setState((current) => (current.error === null ? current : { ...current, error: null }))
        } else {
          const events = await fetchEvents(threadId)
          if (cancelled) return
          lastHead = head
          setState({ events, loaded: true, error: null })
        }
      } catch (failure) {
        if (cancelled) return
        const error = failure instanceof Error ? failure : new Error(String(failure))
        setState((current) => ({ ...current, error }))
      }
      timer = setTimeout(() => void poll(), POLL_MS)
    }

    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [threadId])

  return state
}
