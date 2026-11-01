import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { ERunner, runnerOf, toThreadId } from '@dltech/atlas-core'

import type { ThreadSummary } from '../thread-store'
import { toThreadSummary, tryReadThreadMeta } from './listing'
import { sessionsDirectory, threadMetaFile } from './paths'

/** Every root thread in the home that runs on this machine's pod runner, newest first. */
export async function listLocalPodThreads(args: { home: string }): Promise<ThreadSummary[]> {
  const root = sessionsDirectory({ home: args.home })
  const dirs = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  })
  const found = dirs
    .filter((dir) => dir.isDirectory())
    .map((dir) =>
      tryReadThreadMeta({
        file: threadMetaFile({ sessionDir: join(root, dir.name), threadId: toThreadId(dir.name) }),
      }),
    )
    .filter((meta) => meta !== undefined)
    .filter((meta) => meta.spawnerThreadId === null && runnerOf(meta.runner) === ERunner.Local)
    .map(toThreadSummary)
  return found.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}
