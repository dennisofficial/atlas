import { randomUUID } from 'node:crypto'
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises'

import { z } from 'zod'

import type { ThreadId } from '@dltech/atlas-core'
import { readActivityReplySchema, type ReadActivityReply } from '@dltech/atlas-wire'

import { withActivityFileLock } from './file-lock'

const recordSchema = z.strictObject({
  format: z.literal(1),
  threadId: z.string().min(1),
  runtimeId: readActivityReplySchema.shape.runtimeId,
  revision: readActivityReplySchema.shape.revision,
  turnEpoch: readActivityReplySchema.shape.turnEpoch,
  outcome: readActivityReplySchema.shape.observedOutcome,
})

type Record = z.infer<typeof recordSchema>

type ThreadArgs = { threadId: ThreadId }
type Options = {
  pathFor: (args: ThreadArgs) => Promise<string>
  validateCurrent: (args: ThreadArgs) => Promise<ReadActivityReply>
}

export class FileActivityOutcomesUnavailableError extends Error {
  constructor({ path, reason, cause }: { path: string; reason: string; cause?: unknown }) {
    super(`${reason}: ${path}`, { cause })
    this.name = 'FileActivityOutcomesUnavailableError'
  }
}

async function readRecord({ path, threadId }: ThreadArgs & { path: string }) {
  try {
    const record = recordSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    if (record.threadId !== threadId) throw new Error('Activity outcome belongs to another thread')
    return record
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null
    throw new FileActivityOutcomesUnavailableError({
      path,
      reason: 'Could not read activity outcome',
      cause,
    })
  }
}

async function writeRecord({ path, record }: { path: string; record: Record }): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      const owned = await file.stat()
      try {
        await file.writeFile(JSON.stringify(record))
        await file.sync()
        await rename(temporary, path)
      } finally {
        const current = await lstat(temporary).catch((cause: unknown) => {
          if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null
          throw cause
        })
        if (current !== null && current.dev === owned.dev && current.ino === owned.ino) {
          await unlink(temporary)
        }
      }
    } finally {
      await file.close()
    }
  } catch (cause) {
    throw new FileActivityOutcomesUnavailableError({
      path,
      reason: 'Could not persist activity outcome',
      cause,
    })
  }
}

export function createFileActivityOutcomes({ pathFor, validateCurrent }: Options) {
  return {
    async observe({ threadId, candidate }: ThreadArgs & { candidate: ReadActivityReply }): Promise<{
      snapshot: ReadActivityReply
      outcome: ReadActivityReply['observedOutcome']
    }> {
      const path = await pathFor({ threadId })
      return withActivityFileLock({
        path: `${path}.lock`,
        run: async () => {
          const stored = await readRecord({ path, threadId })
          const snapshot = readActivityReplySchema.parse(await validateCurrent({ threadId }))
          if (candidate.runtimeId !== snapshot.runtimeId) {
            throw new FileActivityOutcomesUnavailableError({
              path,
              reason: 'Activity runtime changed',
            })
          }
          if (
            stored?.runtimeId === snapshot.runtimeId &&
            (snapshot.revision < stored.revision || snapshot.turnEpoch < stored.turnEpoch)
          ) {
            throw new FileActivityOutcomesUnavailableError({
              path,
              reason: 'Activity revision or turn epoch regressed',
            })
          }
          const outcome =
            snapshot.turnEpoch === 0 && snapshot.observedOutcome === null
              ? (stored?.outcome ?? null)
              : snapshot.observedOutcome
          const record = recordSchema.parse({
            format: 1,
            threadId,
            runtimeId: snapshot.runtimeId,
            revision: snapshot.revision,
            turnEpoch: snapshot.turnEpoch,
            outcome,
          })
          if (stored?.runtimeId === record.runtimeId && stored.revision === record.revision) {
            if (
              stored.turnEpoch !== record.turnEpoch ||
              JSON.stringify(stored.outcome) !== JSON.stringify(record.outcome)
            ) {
              throw new FileActivityOutcomesUnavailableError({
                path,
                reason: 'Activity revision conflicts',
              })
            }
            return { snapshot, outcome }
          }
          await writeRecord({ path, record })
          return { snapshot, outcome }
        },
      })
    },
    async read({ threadId }: ThreadArgs): Promise<ReadActivityReply['observedOutcome']> {
      const path = await pathFor({ threadId })
      return withActivityFileLock({
        path: `${path}.lock`,
        run: async () => (await readRecord({ path, threadId }))?.outcome ?? null,
      })
    },
  }
}
