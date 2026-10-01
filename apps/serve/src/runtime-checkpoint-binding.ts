import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { RuntimeCheckpointCapture } from './runtime-checkpoint'
import { EServeEvent, type ServeLog } from './serve-log'

export function bindRuntimeCheckpoint(args: {
  capture: Pick<RuntimeCheckpointCapture, 'capture' | 'flush'>
  log: ServeLog
  publish: (checkpoint: RuntimeCheckpoint) => void
}): {
  current: () => RuntimeCheckpoint | null
  running: () => void
  boot: () => Promise<void>
  finalizePark: () => Promise<void>
} {
  let held: RuntimeCheckpoint | null = null
  let finalized = false
  let pending: Promise<void> | null = null
  let again = false

  const capture = async (phase: ERuntimePhase): Promise<void> => {
    const checkpoint = await args.capture.capture({ phase })
    if (checkpoint === null) return
    held = checkpoint
    args.publish(checkpoint)
  }

  const running = (): void => {
    if (finalized) return
    if (pending !== null) {
      again = true
      return
    }
    pending = (async () => {
      do {
        again = false
        await capture(ERuntimePhase.Running)
      } while (again && !finalized)
    })().catch((failure: unknown) => {
      args.log({ event: EServeEvent.CheckpointPersistFailed, reason: failure instanceof Error ? failure.message : String(failure) })
    }).finally(() => { pending = null })
  }

  return {
    current: () => held,
    running,
    boot: () => capture(ERuntimePhase.Running),
    finalizePark: async () => {
      finalized = true
      await pending
      await capture(ERuntimePhase.Parked)
      if (held?.phase !== ERuntimePhase.Parked) throw new Error('this runtime has no final park checkpoint')
      await args.capture.flush({ timeoutMs: 1_000 })
    },
  }
}
