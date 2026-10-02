import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import { runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

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

export const persistRuntimeCheckpoint = async (args: {
  file: string
  checkpoint: RuntimeCheckpoint
}): Promise<void> => {
  const persisted = await readPersistedRuntimeCheckpoint({ file: args.file })
  if (persisted === null && existsSync(args.file)) {
    throw new Error(
      `the runtime checkpoint at ${args.file} is unreadable; refusing to reset its monotonic revision`,
    )
  }
  if (persisted !== null && args.checkpoint.revision < persisted.revision) {
    throw new Error(
      `refusing to persist checkpoint revision ${args.checkpoint.revision} over the newer ${persisted.revision}`,
    )
  }
  if (
    persisted !== null &&
    args.checkpoint.revision === persisted.revision &&
    JSON.stringify(args.checkpoint) !== JSON.stringify(persisted)
  ) {
    throw new Error(
      `refusing to persist a changed checkpoint at revision ${persisted.revision}, which is already taken`,
    )
  }

  await mkdir(dirname(args.file), { recursive: true })
  const staging = join(dirname(args.file), `.${randomUUID()}.tmp`)
  await writeFile(staging, `${JSON.stringify(args.checkpoint)}\n`, { mode: OWNER_ONLY })
  await rename(staging, args.file)
}
