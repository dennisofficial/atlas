import { useCallback, useEffect, useRef, useState } from 'react'

import { usePageVisible } from '@/lib/use-page-visible'

import { createEventsReader, INITIAL_THREAD_EVENTS, type ThreadEvents } from './events-reader'
import type { ThreadSignalHub } from './thread-signal-hub'
import { useThreadBackend } from './use-thread-backend'

export type { ThreadEvents } from './events-reader'

export type PolledThreadEvents = ThreadEvents & { poke: () => void }

const NOT_READING = () => undefined

export function useThreadEvents(args: {
  threadId: string
  signals: ThreadSignalHub
  enabled: boolean
}): PolledThreadEvents {
  const { threadId, signals, enabled } = args
  const { fetchEvents, fetchSeed, local } = useThreadBackend()
  const [state, setState] = useState(INITIAL_THREAD_EVENTS)
  const pokeRef = useRef<() => void>(NOT_READING)
  const visible = usePageVisible()
  const reading = enabled && visible

  useEffect(() => {
    if (!reading) return undefined
    const reader = createEventsReader({
      threadId,
      localCopy: local,
      fetchSeed: () => fetchSeed(threadId),
      fetchEvents,
      onUpdate: (update) => setState(update),
    })
    const unlisten = signals.listen({ onHead: reader.handleHead })
    pokeRef.current = reader.poke
    reader.start()
    return () => {
      pokeRef.current = NOT_READING
      unlisten()
      reader.stop()
    }
  }, [threadId, signals, reading, fetchEvents, fetchSeed, local])

  const poke = useCallback(() => pokeRef.current(), [])
  return { ...state, poke }
}
