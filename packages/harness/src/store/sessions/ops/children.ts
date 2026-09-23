import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import type { UnloggedChild } from '../../../agents/registry/snapshot'
import { readMetaSync, threadMetaSchema, writeMeta, type ThreadMeta } from '../meta'
import { THREAD_META_FILE_SUFFIX, eventLogFile, threadMetaFile, threadsDirectory } from '../paths'
import type { SessionRegistry } from '../registry'

export type RewoundChildren = {
  detached: readonly ThreadId[]
  orphans: readonly UnloggedChild[]
}

export async function scanSessionThreadMetas({
  sessionDir,
}: {
  sessionDir: string
}): Promise<ReadonlyMap<ThreadId, ThreadMeta>> {
  const dir = threadsDirectory({ sessionDir })
  const files = await readdir(dir).catch(() => [] as string[])
  const metas = new Map<ThreadId, ThreadMeta>()
  for (const file of files) {
    if (!file.endsWith(THREAD_META_FILE_SUFFIX)) continue
    const meta = readMetaSync({ file: join(dir, file), schema: threadMetaSchema })
    if (meta !== undefined) metas.set(toThreadId(meta.id), meta)
  }
  return metas
}

export async function dropRewoundChildren({
  registry,
  sessionDir,
  agentIds,
  at,
}: {
  registry: SessionRegistry
  sessionDir: string
  agentIds: readonly ThreadId[]
  at: string
}): Promise<RewoundChildren> {
  if (agentIds.length === 0) return { detached: [], orphans: [] }

  const metas = await scanSessionThreadMetas({ sessionDir })
  const detached: ThreadId[] = []
  const orphans: UnloggedChild[] = []

  for (const agentId of agentIds) {
    const meta = metas.get(agentId)
    if (meta === undefined) continue

    const referenced = [...metas.values()].some(
      (other) =>
        other.id !== agentId &&
        (other.parentThreadId === agentId || other.spawnerThreadId === agentId),
    )

    if (referenced) {
      await writeMeta({
        file: threadMetaFile({ sessionDir, threadId: agentId }),
        meta: { ...meta, spawnerThreadId: null, agentType: null, updatedAt: at },
      })
      detached.push(agentId)
      continue
    }

    await rm(eventLogFile({ sessionDir, threadId: agentId }), { force: true })
    await rm(threadMetaFile({ sessionDir, threadId: agentId }), { force: true })
    registry.handleFor({ sessionDir }).threads.delete(agentId)
    orphans.push({
      agentId,
      agentType: meta.agentType ?? undefined,
      title: meta.title ?? undefined,
      startedAt: meta.createdAt,
    })
  }

  return { detached, orphans }
}
