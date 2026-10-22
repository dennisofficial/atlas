import type { ThreadId } from '@dltech/atlas-core'
import { runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire/web'

import type { Unsubscribe } from './delta-channel-types'
import { registryOf } from './remote-channel-registry'

export type CheckpointHolder = {
  current(): RuntimeCheckpoint | null
  accept(checkpoint: RuntimeCheckpoint | null | undefined): RuntimeCheckpoint | null
  forget(): void
  onCheckpoint(listener: (checkpoint: RuntimeCheckpoint) => void): Unsubscribe
}

export function createCheckpointHolder(args: { threadId: ThreadId }): CheckpointHolder {
  let held: RuntimeCheckpoint | null = null
  const checkpoints = registryOf<RuntimeCheckpoint>()

  return {
    current: () => held,
    accept(checkpoint) {
      if (checkpoint === null || checkpoint === undefined) return null
      if (checkpoint.threadId !== args.threadId) return null
      if (held !== null && checkpoint.revision <= held.revision) return null
      held = checkpoint
      checkpoints.emit(checkpoint)
      return checkpoint
    },
    forget() {
      held = null
    },
    onCheckpoint: (listener) => checkpoints.add(listener),
  }
}

export const checkpointFrom = (raw: string): RuntimeCheckpoint | null | undefined => {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const checkpoint = Reflect.get(parsed, 'checkpoint')
  if (checkpoint === null) return null
  const valid = runtimeCheckpointSchema.safeParse(checkpoint)
  return valid.success ? valid.data : undefined
}
