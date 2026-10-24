import {
  advancedGate,
  attachedGate,
  gateIsDraining,
  type RevealGate,
  type TailRun,
} from '@dltech/atlas-client/transcript'

export type RevealDriver = {
  setTail(tail: TailRun | null): void
  stop(): void
}

export function createRevealDriver(args: {
  requestFrame: (run: () => void) => number
  cancelFrame: (handle: number) => void
  onGate: (gate: RevealGate | null) => void
}): RevealDriver {
  let gate: RevealGate | null = null
  let tail: TailRun | null = null
  let handle: number | null = null

  const schedule = () => {
    if (handle !== null || !gateIsDraining({ gate, tail })) return
    handle = args.requestFrame(frame)
  }

  function frame() {
    handle = null
    const next = advancedGate({ gate, tail })
    if (next?.key !== gate?.key || next?.revealed !== gate?.revealed) args.onGate(next)
    gate = next
    schedule()
  }

  return {
    setTail(next) {
      tail = next
      const attached = attachedGate({ gate, tail })
      if (attached?.key !== gate?.key || attached?.revealed !== gate?.revealed)
        args.onGate(attached)
      gate = attached
      schedule()
    },
    stop() {
      if (handle !== null) args.cancelFrame(handle)
      handle = null
    },
  }
}
