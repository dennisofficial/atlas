import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { RuntimeCheckpointCapture } from './runtime-checkpoint'
import { EServeEvent, type ServeLog } from './serve-log'

export type RotationResume = {
  parent: boolean
  children?: readonly string[] | undefined
}

export type RuntimeCheckpointBinding = {
  current: () => RuntimeCheckpoint | null
  running: () => void
  boot: () => Promise<void>
  parkBegin: (args: { attempts: number }) => Promise<void>
  parkReopened: () => Promise<void>
  finalizePark: () => Promise<void>
  finalizeRotation: (args: { resume: RotationResume }) => Promise<void>
  rotationReopened: () => Promise<void>
  /**
   * Zeroes a sealed rotation receipt's obligations through the capture's serialized write chain,
   * so it can never lose to a cadence capture writing the same file.
   */
  consumeReceipt: (args: {
    parent?: boolean
    children?: readonly string[] | undefined
  }) => Promise<void>
}

export function bindRuntimeCheckpoint(args: {
  capture: Pick<RuntimeCheckpointCapture, 'capture' | 'flush' | 'consumeReceipt'>
  log: ServeLog
  publish: (checkpoint: RuntimeCheckpoint) => void
}): RuntimeCheckpointBinding {
  let held: RuntimeCheckpoint | null = null
  let finalized = false
  let parking = false
  let pending: Promise<void> | null = null
  let again = false

  const capture = async (given: {
    phase: ERuntimePhase
    attempts?: number | undefined
    resume?: RotationResume | undefined
  }): Promise<void> => {
    const checkpoint = await args.capture.capture(given)
    if (checkpoint === null) return
    held = checkpoint
    args.publish(checkpoint)
  }

  const finalize = async (final: {
    phase: ERuntimePhase.Parked | ERuntimePhase.Updating
    label: string
    resume?: RotationResume | undefined
  }): Promise<void> => {
    finalized = true
    await pending
    if (held?.phase !== final.phase) {
      await capture({
        phase: final.phase,
        ...(final.resume === undefined ? {} : { resume: final.resume }),
      })
    }
    if (held?.phase !== final.phase)
      throw new Error(`this runtime has no final ${final.label} checkpoint`)
    await args.capture.flush({ timeoutMs: 1_000 })
  }

  const capturesHeld = (): boolean => finalized || parking

  const running = (): void => {
    if (capturesHeld()) return
    if (pending !== null) {
      again = true
      return
    }
    pending = (async () => {
      do {
        again = false
        await capture({ phase: ERuntimePhase.Serving })
      } while (again && !capturesHeld())
    })()
      .catch((failure: unknown) => {
        args.log({
          event: EServeEvent.CheckpointPersistFailed,
          reason: failure instanceof Error ? failure.message : String(failure),
        })
      })
      .finally(() => {
        pending = null
      })
  }

  const reopenToServing = async (): Promise<void> => {
    parking = false
    await capture({ phase: ERuntimePhase.Serving })
  }

  return {
    current: () => held,
    running,
    boot: () => capture({ phase: ERuntimePhase.Serving }),
    parkBegin: async ({ attempts }) => {
      parking = true
      await pending
      await capture({ phase: ERuntimePhase.Parking, attempts })
    },
    parkReopened: reopenToServing,
    finalizePark: () => finalize({ phase: ERuntimePhase.Parked, label: 'park' }),
    finalizeRotation: ({ resume }) =>
      finalize({ phase: ERuntimePhase.Updating, label: 'rotation', resume }),
    rotationReopened: reopenToServing,
    consumeReceipt: (given) => args.capture.consumeReceipt(given),
  }
}
