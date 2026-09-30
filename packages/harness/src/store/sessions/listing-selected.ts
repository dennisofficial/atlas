import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { readMeta, threadMetaSchema, type ThreadMeta } from './meta'
import { sessionDirectory, threadMetaFile } from './paths'
import { readThreadMetas } from './listing'

export type SelectedRoot = { sessionDir: string; root: ThreadMeta; activityAt: string }

function safeIdOf({ id }: { id: ThreadId }): string | undefined {
  if (id === '' || id === '.' || id === '..') return undefined
  if (id.includes('/') || id.includes('\\') || id.includes('\0')) return undefined
  return id
}

async function selectedRoot({
  home,
  project,
  id,
}: {
  home: string
  project: string
  id: ThreadId
}): Promise<SelectedRoot | undefined> {
  const safe = safeIdOf({ id })
  if (safe === undefined) return undefined
  const sessionDir = sessionDirectory({ home, sessionId: toThreadId(safe) })
  const root = await readMeta({ file: threadMetaFile({ sessionDir, threadId: toThreadId(safe) }), schema: threadMetaSchema }).catch(
    () => undefined,
  )
  if (root === undefined || root.spawnerThreadId !== null) return undefined
  if (root.repo !== project && root.workspace !== project) return undefined
  const metas = await readThreadMetas({ sessionDir })
  const activityAt = metas.reduce((latest, meta) => (meta.updatedAt > latest ? meta.updatedAt : latest), root.updatedAt)
  return { sessionDir, root, activityAt }
}

export async function selectedRoots({
  home,
  project,
  ids,
}: {
  home: string
  project: string
  ids: readonly ThreadId[]
}): Promise<SelectedRoot[]> {
  const found = await Promise.all(ids.map((id) => selectedRoot({ home, project, id })))
  return found.filter((entry): entry is SelectedRoot => entry !== undefined)
}
