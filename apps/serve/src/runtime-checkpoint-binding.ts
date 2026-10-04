import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { RuntimeCheckpointCapture } from './runtime-checkpoint'
import { EServeEvent, type ServeLog } from './serve-log'

export type RuntimeCheckpointBinding = {
  current: () => RuntimeCheckpoint | null
  running: () => void
  boot: () => Promise<void>
  finalizePark: () => Promise<void>
  finalizeRotation: () => Promise<void>
}

export function bindRuntimeCheckpoint(args: {
  capture: Pick<RuntimeCheckpointCapture, 'capture' | 'flush'>
  log: ServeLog
  publish: (checkpoint: RuntimeCheckpoint) => void
}): RuntimeCheckpointBinding {
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

  const finalize = async (final: { phase: ERuntimePhase; label: string }): Promise<void> => {
    finalized = true
    await pending
    if (held?.phase !== final.phase) await capture(final.phase)
    if (held?.phase !== final.phase) throw new Error(`this runtime has no final ${final.label} checkpoint`)
    await args.capture.flush({ timeoutMs: 1_000 })
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
    finalizePark: () => finalize({ phase: ERuntimePhase.Parked, label: 'park' }),
    finalizeRotation: () => finalize({ phase: ERuntimePhase.Rotating, label: 'rotation' }),
  }
}
