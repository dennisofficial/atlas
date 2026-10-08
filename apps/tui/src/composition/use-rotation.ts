import type { ThreadId } from '@dltech/atlas-core'
import { ERotationPhase, RotationBusy, type RotationSettle } from '@dltech/atlas-harness'
import { EWireRotationPhase } from '@dltech/atlas-wire'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Rotating } from '../ui/components/rotating'
import type { AtlasApp } from './compose'
import { displayPhaseOf } from './rotation-phase'
import { guardedActivation } from './rotation-recovery'
import type { TurnDriver } from './use-turn-driver'

const BUSY = 'a rotation is already underway'

const COMPACTING = 'a rotation waits for the compaction to finish'

const MOVING = 'a rotation waits for the move between host, container and cloud to finish'

const UNAVAILABLE = 'this session cannot rotate its main thread'

const incomplete = (reason: string): string => `the rotation did not complete: ${reason}`

export type RotationControl = {
  rotating: Rotating | null
  handleRotate: (instructions: string | undefined) => void
}

export function useRotation(args: {
  app: Pick<AtlasApp, 'rotation' | 'pending' | 'log' | 'runner' | 'channel'>
  threadId: ThreadId
  readClock: () => number
  compacting: boolean
  moving: boolean
  driver: Pick<TurnDriver, 'handlePauseForMove' | 'whenSettled' | 'turnInFlight' | 'lastOutcome'>
  onFailure: (reason: string) => void
  onRotated: (args: { successor: ThreadId }) => void
}): RotationControl {
  const { app, threadId, readClock, compacting, moving, driver, onFailure, onRotated } = args
  const port = app.rotation
  const [rotating, setRotating] = useState<Rotating | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    if (port === undefined) return undefined

    return port.subscribe((stage) => {
      if (!inFlight.current || stage.sessionId !== threadId) return

      const phase = displayPhaseOf(stage.phase)
      if (phase === null) return

      setRotating((current) => (current === null ? null : { ...current, phase }))
    })
  }, [port, threadId])

  useEffect(() => {
    if (port === undefined || inFlight.current) return

    void (async () => {
      const held = await port.status({ sessionId: threadId })
      const committed = held.kind === 'active' && held.phase === ERotationPhase.Committed
      const successor = held.kind === 'active' ? held.successor : undefined

      if (committed && successor !== undefined) {
        await port.recover({
          sessionId: threadId,
          activate: guardedActivation({ app, successor, turnInFlight: driver.turnInFlight }),
        })
        if (held.predecessor === threadId) onRotated({ successor })
        return
      }
      await port.recover({ sessionId: threadId })
    })().catch(() => undefined)
  }, [app, driver.turnInFlight, onRotated, port, threadId])

  const handleRotate = useCallback(
    (instructions: string | undefined) => {
      if (inFlight.current) return onFailure(BUSY)
      if (compacting) return onFailure(COMPACTING)
      if (moving) return onFailure(MOVING)
      if (port === undefined) return onFailure(UNAVAILABLE)

      const running = driver.turnInFlight()
      const settle: RotationSettle = {
        pause: driver.handlePauseForMove,
        waitSettled: async () => {
          await driver.whenSettled()
          return running ? driver.lastOutcome.current : null
        },
      }

      inFlight.current = true
      setRotating({ startedAt: readClock(), phase: EWireRotationPhase.Settling })

      void port
        .request({ sessionId: threadId, predecessor: threadId, instructions: instructions ?? '', settle })
        .then((outcome) => {
          if (outcome.kind !== 'committed') return onFailure(incomplete(outcome.reason))

          const carried = app.pending.forThread({ threadId }).drain()
          const successor = app.pending.forThread({ threadId: outcome.successor })
          for (const said of carried) successor.enqueue(said)
          onRotated({ successor: outcome.successor })
        })
        .catch((fault: unknown) =>
          onFailure(
            fault instanceof RotationBusy
              ? BUSY
              : incomplete(fault instanceof Error ? fault.message : String(fault)),
          ),
        )
        .finally(() => {
          inFlight.current = false
          setRotating(null)
        })
    },
    [app.pending, compacting, driver, moving, onFailure, onRotated, port, readClock, threadId],
  )

  return { rotating, handleRotate }
}
