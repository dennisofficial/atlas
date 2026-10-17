import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import {
  canTransition,
  ERuntimePhase,
  runtimeCheckpointSchema,
  type RuntimeCheckpoint,
  type SandboxRotationReceipt,
} from '@dltech/atlas-wire'

export const acceptsRuntimeCheckpoint = (args: {
  stored: RuntimeCheckpoint | null
  reported: RuntimeCheckpoint
}): boolean => {
  if (args.stored === null) return true
  return args.reported.revision > args.stored.revision
}

const OWNER_ONLY = 0o600

export const RUNTIME_CHECKPOINT_RELATIVE_PATH = join('operational', 'runtime-checkpoint.json')

export const runtimeCheckpointFile = (args: { atlasHome: string }): string =>
  join(args.atlasHome, RUNTIME_CHECKPOINT_RELATIVE_PATH)

export const readPersistedRuntimeCheckpoint = async (args: {
  file: string
}): Promise<RuntimeCheckpoint | null> => {
  let text: string
  try {
    text = await readFile(args.file, 'utf8')
  } catch {
    return null
  }

  try {
    return runtimeCheckpointSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

export const readSandboxRotationReceipt = async (args: {
  atlasHome: string
}): Promise<SandboxRotationReceipt | null> => {
  const persisted = await readPersistedRuntimeCheckpoint({ file: runtimeCheckpointFile(args) })
  if (persisted === null) return null
  if (persisted.phase === ERuntimePhase.Updating) return persisted.receipt
  if (persisted.phase === ERuntimePhase.Serving) return persisted.receipt ?? null
  return null
}

export const persistSandboxRotationReceipt = async (args: {
  atlasHome: string
  receipt: SandboxRotationReceipt
}): Promise<void> => {
  const file = runtimeCheckpointFile(args)
  const persisted = await readPersistedRuntimeCheckpoint({ file })
  const revision =
    persisted === null
      ? 1
      : persisted.phase === ERuntimePhase.Updating
        ? persisted.revision
        : persisted.revision + 1
  await persistRuntimeCheckpoint({
    file,
    checkpoint: { ...args.receipt.checkpoint, revision, receipt: args.receipt },
  })
}

export const consumeSandboxRotationReceipt = async (args: {
  atlasHome: string
  receipt: SandboxRotationReceipt
  parent?: boolean
  children?: readonly string[]
}): Promise<void> => {
  const file = runtimeCheckpointFile(args)
  // The checkpoint's own cadence captures write the same file, so the revision fence can reject a
  // consumption written against a stale read. Re-read and retry; the fence is the guard, not a bug.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const persisted = await readPersistedRuntimeCheckpoint({ file })
    if (
      persisted === null ||
      (persisted.phase !== ERuntimePhase.Updating && persisted.phase !== ERuntimePhase.Serving)
    ) {
      return
    }
    const owed = persisted.receipt
    if (owed === undefined) return
    if (owed.threadId !== args.receipt.threadId || owed.sandboxSessionId !== args.receipt.sandboxSessionId) {
      return
    }
    const consumed = {
      ...owed,
      ...(args.parent === true ? { resumeParent: false } : {}),
      ...(args.children === undefined
        ? {}
        : {
            resumeChildren: (owed.resumeChildren ?? []).filter(
              (child) => !args.children?.includes(child),
            ),
          }),
    }
    if (JSON.stringify(consumed) === JSON.stringify(owed)) return
    const discharged = !consumed.resumeParent && (consumed.resumeChildren ?? []).length === 0
    const { receipt: _owed, ...rest } = persisted
    try {
      if (persisted.phase === ERuntimePhase.Updating) {
        await persistRuntimeCheckpoint({
          file,
          checkpoint: {
            ...rest,
            revision: persisted.revision + 1,
            phase: ERuntimePhase.Updating,
            receipt: consumed,
          },
        })
        return
      }
      await persistRuntimeCheckpoint({
        file,
        checkpoint: {
          ...rest,
          revision: persisted.revision + 1,
          phase: ERuntimePhase.Serving,
          ...(discharged ? {} : { receipt: consumed }),
        },
      })
      return
    } catch (failure) {
      if (attempt === 4) throw failure
    }
  }
}

const transitionLegal = (args: {
  persisted: RuntimeCheckpoint
  checkpoint: RuntimeCheckpoint
}): boolean => {
  if (args.checkpoint.phase === args.persisted.phase) return true
  if (canTransition({ from: args.persisted.phase, to: args.checkpoint.phase })) return true
  if (
    args.persisted.phase === ERuntimePhase.Parked &&
    args.checkpoint.phase === ERuntimePhase.Serving &&
    args.checkpoint.runtimeId !== args.persisted.runtimeId
  ) {
    return true
  }
  return false
}

export const persistRuntimeCheckpoint = async (args: {
  file: string
  checkpoint: RuntimeCheckpoint
}): Promise<void> => {
  const checkpoint = runtimeCheckpointSchema.parse(args.checkpoint)
  const persisted = await readPersistedRuntimeCheckpoint({ file: args.file })
  if (persisted === null && existsSync(args.file)) {
    throw new Error(
      `the runtime checkpoint at ${args.file} is unreadable; refusing to reset its monotonic revision`,
    )
  }
  if (persisted !== null && checkpoint.revision < persisted.revision) {
    throw new Error(
      `refusing to persist checkpoint revision ${checkpoint.revision} over the newer ${persisted.revision}`,
    )
  }
  if (
    persisted !== null &&
    checkpoint.revision === persisted.revision &&
    JSON.stringify(checkpoint) !== JSON.stringify(persisted)
  ) {
    throw new Error(
      `refusing to persist a changed checkpoint at revision ${persisted.revision}, which is already taken`,
    )
  }
  if (
    persisted !== null &&
    checkpoint.revision === persisted.revision + 1 &&
    !transitionLegal({ persisted, checkpoint })
  ) {
    throw new Error(
      `refusing the lifecycle transition ${persisted.phase} -> ${checkpoint.phase} at revision ${checkpoint.revision}`,
    )
  }
  const directory = dirname(args.file)
  await mkdir(directory, { recursive: true })
  const staging = join(directory, `.${randomUUID()}.tmp`)
  const handle = await open(staging, 'wx', OWNER_ONLY)
  try {
    await handle.writeFile(`${JSON.stringify(checkpoint)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(staging, args.file)
  const parent = await open(directory, 'r')
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
}
