import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { LogPort, ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '../logs'
import { readThreadMetas, tryReadThreadMeta } from './listing'
import { newThreadMeta, writeMeta, type ThreadMeta } from './meta'
import { eventLogFile, sessionsDirectory, threadMetaFile } from './paths'
import type { SessionRegistry } from './registry'

export async function touchThreadMeta({
  registry,
  sessionDir,
  threadId,
  at,
}: {
  registry: SessionRegistry
  sessionDir: string
  threadId: ThreadId
  at: string
}): Promise<void> {
  const file = threadMetaFile({ sessionDir, threadId })
  const meta = tryReadThreadMeta({ file }) ?? newThreadMeta({ id: threadId, at })
  const log = await registry.readThreadLog({ sessionDir, threadId })
  await writeMeta({ file, meta: { ...meta, head: log.head, updatedAt: at } })
}

export async function dropRewoundChildren({
  home,
  registry,
  agentIds,
  logPort,
}: {
  home: string
  registry: SessionRegistry
  agentIds: readonly ThreadId[]
  logPort?: LogPort | undefined
}): Promise<void> {
  if (agentIds.length === 0) return
  const root = sessionsDirectory({ home })
  const dirs = await readdir(root, { withFileTypes: true }).catch((error) => {
    warnDirectoryUnreadable({ logPort, path: root, error })
    return []
  })
  const located: { sessionDir: string; meta: ThreadMeta }[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const sessionDir = join(root, dir.name)
    for (const meta of await readThreadMetas({ sessionDir, logPort })) located.push({ sessionDir, meta })
  }
  for (const agentId of agentIds) {
    const referenced = located.some(({ meta }) => meta.spawnerThreadId === agentId || meta.parentThreadId === agentId)
    const found = located.find(({ meta }) => meta.id === agentId)
    if (found === undefined) continue
    if (referenced) {
      await writeMeta({
        file: threadMetaFile({ sessionDir: found.sessionDir, threadId: agentId }),
        meta: { ...found.meta, spawnerThreadId: null, agentType: null },
      })
      continue
    }
    await rm(threadMetaFile({ sessionDir: found.sessionDir, threadId: agentId }), { force: true })
    await rm(eventLogFile({ sessionDir: found.sessionDir, threadId: agentId }), { force: true })
    const cached = registry.handleFor({ sessionDir: found.sessionDir }).threads.get(agentId)
    if (cached !== undefined) {
      cached.events.length = 0
      cached.unreadable.length = 0
      cached.head = 0
      cached.byContext.clear()
    }
  }
}

export function warnDirectoryUnreadable({
  logPort,
  path,
  error,
}: {
  logPort: LogPort | undefined
  path: string
  error: unknown
}): void {
  const code = errorCodeOf({ error })
  logPort?.warn({
    source: 'store.listing',
    message: 'could not list a sessions directory, treating it as empty',
    data: { path, ...(code === undefined ? {} : { code }) },
    ...logFieldsOf({ error }),
  })
}

function errorCodeOf({ error }: { error: unknown }): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
