import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'

import type { OpenedConversation } from './open-conversation'
import type { TurnDriver } from './turn-driver-types'

export function useAdopt(args: {
  turnDriver: TurnDriver
  setFailure: (reason: string | null) => void
  setReported: (next: null) => void
  holdMove: (next: null) => void
  startedRef: RefObject<boolean>
  setEvents: (events: OpenedConversation['events']) => void
  setName: (name: string | null) => void
  setOpened: Dispatch<SetStateAction<OpenedConversation>>
  onLocalOpened: ((next: OpenedConversation) => void) | undefined
}): (next: OpenedConversation) => void {
  const { turnDriver, setFailure, setReported, holdMove, startedRef, setEvents, setName } = args
  const { setOpened, onLocalOpened } = args
  return useCallback(
    (next: OpenedConversation) => {
      turnDriver.settle()
      setFailure(null)
      setReported(null)
      holdMove(null)
      startedRef.current = next.started
      setEvents(next.events)
      setName(next.name)
      setOpened(next)
      onLocalOpened?.(next)
    },
    [
      turnDriver,
      setFailure,
      setReported,
      holdMove,
      startedRef,
      setEvents,
      setName,
      setOpened,
      onLocalOpened,
    ],
  )
}
