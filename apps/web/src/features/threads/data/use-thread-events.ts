import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePageVisible } from '@/lib/use-page-visible'

import { createEventsReader, INITIAL_THREAD_EVENTS, type ThreadEvents } from './events-reader'
import { createTranscriptHistory, type TranscriptHistory } from './transcript-history'
import type { ThreadSignalHub } from './thread-signal-hub'
import { useThreadBackend } from './use-thread-backend'

export type { ThreadEvents } from './events-reader'

export type PolledThreadEvents = ThreadEvents & { poke: () => void }

const NOT_READING = () => undefined

export function useThreadEvents(args: {
  threadId: string
  signals: ThreadSignalHub
  enabled: boolean
  history?: TranscriptHistory
}): PolledThreadEvents {
  const { threadId, signals, enabled } = args
  const { fetchEvents, fetchSeed, fetchSnapshot, local } = useThreadBackend()
  const history = useMemo(
    () => args.history ?? createTranscriptHistory({ threadId, fetchSeed, fetchSnapshot }),
    [args.history, threadId, fetchSeed, fetchSnapshot],
  )
  useEffect(() => history.retain(), [history])
  const [state, setState] = useState({ history, value: INITIAL_THREAD_EVENTS })
  const pokeRef = useRef<() => void>(NOT_READING)
  const visible = usePageVisible()
  const reading = enabled && visible

  useEffect(() => {
    if (!reading) return undefined
    const cached = history.snapshot()
    let current: ThreadEvents =
      cached === undefined ? INITIAL_THREAD_EVENTS : { events: cached, loaded: true, error: null }
    setState({ history, value: current })
    const reader = createEventsReader({
      threadId,
      localCopy: local,
      fetchSeed: history.readSnapshot,
      fetchEvents,
      fetchSnapshot: history.fetchSnapshot,
      onAccept: history.replaceSnapshot,
      onUpdate: (update) => {
        current = update(current)
        setState({ history, value: current })
      },
    })
    const unlisten = local
      ? signals.listen({ onHead: reader.handleHead })
      : signals.listen({
          onCheckpoint: (checkpoint) => {
            history.expectEpoch(checkpoint)
            reader.handleCheckpoint(checkpoint)
          },
          onEvents: (batch) => {
            history.expectEpoch(batch)
            reader.handleEvents(batch)
          },
          onReset: (checkpoint) => {
            history.expectEpoch(checkpoint)
            reader.handleReset(checkpoint)
          },
        })
    pokeRef.current = reader.poke
    reader.start()
    if (cached !== undefined) reader.poke()
    return () => {
      pokeRef.current = NOT_READING
      unlisten()
      reader.stop()
    }
  }, [threadId, signals, reading, fetchEvents, fetchSnapshot, history, local])

  const poke = useCallback(() => pokeRef.current(), [])
  const current = state.history === history ? state.value : INITIAL_THREAD_EVENTS
  const cached = history.snapshot()
  return cached === undefined
    ? { ...current, poke }
    : { ...current, events: cached, loaded: true, poke }
}
