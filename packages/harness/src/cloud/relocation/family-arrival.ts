import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'
import type { ThreadStorePort } from '../../store/thread-store'
import { writeFamilyOwnership } from '../../workspace/family-ownership'
import type { RestoredWorkspace } from '../../workspace/transfer/manifest'

export async function storedFamilyIds(args: {
  threadId: ThreadId
  threads: Pick<ThreadStorePort, 'spawned'>
}): Promise<ThreadId[]> {
  const family: ThreadId[] = [args.threadId]
  for (const threadId of family) {
    const children = await args.threads.spawned({ threadId })
    for (const child of children) if (!family.includes(child.id)) family.push(child.id)
  }
  return family
}

export async function validateFamilyArrival(args: {
  threadId: ThreadId
  restored: RestoredWorkspace
  threads: Pick<ThreadStorePort, 'spawned'>
}): Promise<ThreadId[]> {
  const family = await storedFamilyIds(args)
  const mappings = args.restored.family
  if (mappings === undefined) return family
  if (mappings.rootId !== args.threadId) throw new Error('the restored family mapping names a different root')
  const mappedIds = new Set(mappings.threads.map((entry) => entry.threadId))
  if (mappedIds.size !== mappings.threads.length || mappedIds.size !== family.length || family.some((id) => !mappedIds.has(id))) {
    throw new Error('the restored workspace has an incomplete or duplicate family mapping')
  }
  const treePaths = new Set(args.restored.trees.map((tree) => tree.path))
  for (const entry of mappings.threads) {
    if (entry.active !== null && !treePaths.has(entry.active.path)) throw new Error(`family mapping for ${entry.threadId} names an unrestored active checkout`)
  }
  for (const checkout of mappings.checkouts) {
    if (!treePaths.has(checkout.path)) throw new Error(`family ownership mapping names an unrestored checkout: ${checkout.path}`)
  }
  return family
}

export async function recordFamilyOwnershipArrival(args: {
  threadId: ThreadId
  restored: RestoredWorkspace
  sessionDir?: string | undefined
}): Promise<void> {
  const family = args.restored.family
  if (family === undefined || args.restored.repository === null) return
  await writeFamilyOwnership({
    sessionDir: args.sessionDir ?? sessionDirectory({ home: atlasDirectory(), sessionId: args.threadId }),
    ownership: {
      version: 1,
      rootId: family.rootId,
      primaryRepository: args.restored.repository,
      checkouts: family.checkouts.map((checkout) => ({ ...checkout, claimedBy: toThreadId(checkout.claimedBy) })),
    },
  })
}
