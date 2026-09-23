import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { readMetaSync, threadMetaSchema, type ThreadMeta } from '../../store/sessions/meta'
import { THREAD_META_FILE_SUFFIX, threadsDirectory } from '../../store/sessions/paths'
import { SUPERVISION_DEPTH_LIMIT, SupervisionTreeTooDeep } from '../spawned-threads'

export async function readSessionSpawnedThreadIds({
  sessionDir,
  threadId,
}: {
  sessionDir: string
  threadId: ThreadId
}): Promise<ThreadId[]> {
  const metas = await readThreadMetas({ sessionDir })
  const collected: ThreadId[] = []
  let frontier: ThreadId[] = [threadId]

  for (let level = 0; level < SUPERVISION_DEPTH_LIMIT; level += 1) {
    frontier = spawnedBy({ metas, spawners: frontier })
    collected.push(...frontier)
  }

  if (spawnedBy({ metas, spawners: frontier }).length > 0) {
    throw new SupervisionTreeTooDeep({ threadId, limit: SUPERVISION_DEPTH_LIMIT })
  }
  return collected
}

async function readThreadMetas({ sessionDir }: { sessionDir: string }): Promise<ThreadMeta[]> {
  const directory = threadsDirectory({ sessionDir })
  const names = await readdir(directory).catch(() => [] as string[])
  const metas: ThreadMeta[] = []
  for (const name of names) {
    if (!name.endsWith(THREAD_META_FILE_SUFFIX)) continue
    const meta = readMetaSync({ file: join(directory, name), schema: threadMetaSchema })
    if (meta !== undefined) metas.push(meta)
  }
  return metas.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function spawnedBy({
  metas,
  spawners,
}: {
  metas: readonly ThreadMeta[]
  spawners: readonly ThreadId[]
}): ThreadId[] {
  if (spawners.length === 0) return []
  const wanted = new Set<string>(spawners)
  return metas
    .filter((meta) => meta.spawnerThreadId !== null && wanted.has(meta.spawnerThreadId))
    .map((meta) => toThreadId(meta.id))
}
