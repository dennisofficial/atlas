import { join } from 'node:path'

import type { RestoredFamily, WorkspaceManifest } from './manifest'
import { isDirectory } from './restore-files'
import type { TreeOutcome } from './restore-types'

export async function restoredFamilyOf({
  manifest,
  outcomes,
}: {
  manifest: WorkspaceManifest
  outcomes: readonly TreeOutcome[]
}): Promise<RestoredFamily | undefined> {
  const family = manifest.family
  if (family === undefined) return undefined
  const outcomeOf = (treeId: string): TreeOutcome => {
    const found = outcomes.find(({ planned }) => planned.tree.id === treeId)
    if (found === undefined) throw new Error(`archive family names tree ${treeId}, which was not restored`)
    return found
  }
  const threads: RestoredFamily['threads'] = []
  for (const thread of family.threads) {
    const homeTree = outcomeOf(thread.home.treeId)
    const home = thread.home.relativePath === '' ? homeTree.planned.path : join(homeTree.planned.path, ...thread.home.relativePath.split('/'))
    if (!(await isDirectory(home))) throw new Error(`restored home ${home} of thread ${thread.threadId} does not exist`)
    if (thread.active === null) {
      threads.push({ threadId: thread.threadId, home, active: null })
      continue
    }
    const active = outcomeOf(thread.active.treeId)
    if (active.branch === null) throw new Error(`restored active tree ${active.planned.path} of thread ${thread.threadId} has no branch`)
    threads.push({
      threadId: thread.threadId,
      home,
      active: { path: active.planned.path, branch: active.branch, base: thread.active.base, adopted: thread.active.adopted },
    })
  }
  return {
    rootId: family.rootId,
    checkouts: family.checkouts.map((checkout) => ({ id: checkout.id, path: outcomeOf(checkout.treeId).planned.path, claimedBy: checkout.claimedBy })),
    threads,
  }
}
