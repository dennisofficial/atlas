import { useCallback, useEffect, useRef, useState } from 'react'

import { usePageVisible } from '@/lib/use-page-visible'

import { createEventsPoller, INITIAL_THREAD_EVENTS, type ThreadEvents } from './events-poller'
import { fetchEvents, fetchHead } from './threads-api'

export type { ThreadEvents } from './events-poller'

export type PolledThreadEvents = ThreadEvents & { poke: () => void }

const NOT_POLLING = () => undefined

export function useThreadEvents(threadId: string, enabled = true): PolledThreadEvents {
  const [state, setState] = useState(INITIAL_THREAD_EVENTS)
  const pokeRef = useRef<() => void>(NOT_POLLING)
  const visible = usePageVisible()
  const polling = enabled && visible

  useEffect(() => {
    if (!polling) return undefined
    const poller = createEventsPoller({
      threadId,
      fetchHead,
      fetchEvents,
      onUpdate: (update) => setState(update),
    })
    pokeRef.current = poller.poke
    poller.start()
    return () => {
      pokeRef.current = NOT_POLLING
      poller.stop()
    }
  }, [threadId, polling])

  const poke = useCallback(() => pokeRef.current(), [])
  return { ...state, poke }
}
