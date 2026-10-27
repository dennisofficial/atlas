import { useCallback, useRef, useState } from 'react'

import { EKeyGroup, EKeyLayer, useKeyBindings } from '../ui/keys'

export type StopArm = {
  stopArmed: boolean
  isArmed: () => boolean
  armStop: (armed: boolean) => void
  disarmStop: () => void
}

/**
 * The escape binding re-registers on its hint's change one render after the arm flips, so a fast
 * second escape can still reach the handler that read the unarmed state. The ref is the answer
 * the handler actually trusts — it is current the moment the state is set, before any effect.
 */
export function useStopArm(): StopArm {
  const [stopArmed, setStopArmed] = useState(false)
  const armedRef = useRef(false)

  const armStop = useCallback((armed: boolean) => {
    armedRef.current = armed
    setStopArmed(armed)
  }, [])
  const isArmed = useCallback(() => armedRef.current, [])
  const disarmStop = useCallback((): void => {
    if (armedRef.current) armStop(false)
  }, [armStop])

  return { stopArmed, isArmed, armStop, disarmStop }
}

/**
 * The hint never changes while a child is open: the registry re-binds on a hint's change one render
 * after the arm flips, and a second escape landing in that gap would fall through to the global
 * interrupt instead of stopping the child. The arming is announced by the notice, not the hint.
 */
export function useAgentEscapeBinding(args: {
  active: boolean
  stopHint: string | null
  backLabel: string | null
  run: () => void
}): void {
  const hint = args.stopHint ?? args.backLabel ?? 'back to the parent'

  useKeyBindings(
    args.active
      ? [
          {
            chord: 'escape',
            hint,
            layer: EKeyLayer.Block,
            group: EKeyGroup.Session,
            run: args.run,
          },
        ]
      : [],
  )
}
