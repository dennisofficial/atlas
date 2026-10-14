import type { ThreadId } from '@dltech/atlas-core'
import {
  ERotationPhase,
  RotationBusy,
  type RotationOutcome,
  type RotationSettle,
} from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Rotating } from '../ui/components/rotating-line'
import type { AtlasApp } from './compose'
import type { TurnDriver } from './use-turn-driver'

const BUSY = 'a rotation is already underway'

const COMPACTING = 'a rotation waits for the compaction to finish'

const MOVING = 'a rotation waits for the move between host, container and cloud to finish'

const UNAVAILABLE = 'this session cannot rotate its main thread'

const incomplete = (reason: string): string => `the rotation did not complete: ${reason}`

const failureOf = (outcome: Exclude<RotationOutcome, { kind: 'rotated' }>): string =>
  outcome.kind === 'refused' ? outcome.reason : incomplete(outcome.reason)

export type RotationControl = {
  rotating: Rotating | null
  handleRotate: (instructions: string | undefined) => void
  cancel: () => boolean
}

export function useRotation(args: {
  app: Pick<AtlasApp, 'rotation' | 'intake'>
  threadId: ThreadId
  readClock: () => number
  compacting: boolean
  moving: boolean
  driver: Pick<TurnDriver, 'handlePauseForMove' | 'whenSettled' | 'turnInFlight' | 'lastOutcome'>
  refresh: () => Promise<void>
  onFailure: (reason: string) => void
  onRotated: () => void
}): RotationControl {
  const { app, threadId, readClock, compacting, moving, driver, refresh, onFailure, onRotated } =
    args
  const port = app.rotation
  const [rotating, setRotating] = useState<Rotating | null>(null)
  const rotation = useRef<AbortController | null>(null)

  useEffect(() => {
    if (port === undefined) return undefined

    return port.subscribe((stage) => {
      if (rotation.current === null || stage.sessionId !== threadId) return

      setRotating((current) => (current === null ? null : { ...current, phase: stage.phase }))
    })
  }, [port, threadId])

  const handleRotate = useCallback(
    (instructions: string | undefined) => {
      if (rotation.current !== null) return onFailure(BUSY)
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

      const controller = new AbortController()
      rotation.current = controller
      const releaseIntake = app.intake?.hold({ threadId })
      setRotating({ startedAt: readClock(), phase: ERotationPhase.Settling })

      void (async () => {
        try {
          const outcome = await port.request({
            sessionId: threadId,
            threadId,
            instructions: instructions ?? '',
            settle,
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          if (outcome.kind !== 'rotated') return onFailure(failureOf(outcome))

          onRotated()
          await refresh()
        } catch (fault) {
          if (controller.signal.aborted) return
          onFailure(
            fault instanceof RotationBusy
              ? BUSY
              : incomplete(fault instanceof Error ? fault.message : String(fault)),
          )
        } finally {
          rotation.current = null
          setRotating(null)
          releaseIntake?.()
        }
      })()
    },
    [app.intake, compacting, driver, moving, onFailure, onRotated, port, readClock, refresh, threadId],
  )

  const cancel = useCallback((): boolean => {
    const running = rotation.current
    if (running === null) return false

    running.abort()
    return true
  }, [])

  return { rotating, handleRotate, cancel }
}
