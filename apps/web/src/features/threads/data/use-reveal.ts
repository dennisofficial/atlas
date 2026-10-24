import {
  attachedGate,
  tailRunOfSteps,
  type InFlightStep,
  type RevealGate,
} from '@dltech/atlas-client/transcript'
import type { Event } from '@dltech/atlas-core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { createRevealDriver, type RevealDriver } from './reveal-driver'

export function useReveal(args: {
  steps: readonly InFlightStep[]
  events: readonly Event[]
}): RevealGate | null {
  const tail = useMemo(
    () => tailRunOfSteps({ steps: args.steps, events: args.events }),
    [args.steps, args.events],
  )
  const [revealed, setRevealed] = useState<RevealGate | null>(null)
  const driverRef = useRef<RevealDriver | null>(null)

  useEffect(() => {
    const driver = createRevealDriver({
      requestFrame: (run) => requestAnimationFrame(run),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      onGate: setRevealed,
    })
    driverRef.current = driver
    return () => driver.stop()
  }, [])

  useEffect(() => {
    driverRef.current?.setTail(tail)
  }, [tail])

  return useMemo(() => attachedGate({ gate: revealed, tail }), [revealed, tail])
}
