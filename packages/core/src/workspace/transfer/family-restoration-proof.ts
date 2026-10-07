import type { RestoredFamily, WorkspaceFamily } from './family-manifest'

export type RestorationManifestTree = { id: string; sourcePath: string }

export type RestorationTree = { id: string; sourcePath: string; path: string; branch: string | null }

export type RestorationManifest = {
  trees: readonly RestorationManifestTree[]
  family?: WorkspaceFamily | undefined
}

export type RestorationResult = {
  trees: readonly RestorationTree[]
  family?: RestoredFamily | undefined
}

const joinTreePath = ({ treePath, relativePath }: { treePath: string; relativePath: string }): string => {
  const segments = relativePath.split('/').filter((segment) => segment !== '' && segment !== '.')
  return [treePath, ...segments].join('/').replace(/\/{2,}/g, '/')
}

export function verifyFamilyRestoration(args: { manifest: RestorationManifest; restored: RestorationResult }): void {
  const expected = args.manifest.family
  if (expected === undefined) return
  const actual = args.restored.family
  if (actual === undefined || actual.rootId !== expected.rootId) throw new Error('the destination did not restore the captured family mapping')
  const trees = new Map(args.restored.trees.map((tree) => [tree.id, tree]))
  if (trees.size !== args.manifest.trees.length || trees.size !== args.restored.trees.length) throw new Error('the destination did not restore every family checkout exactly once')
  for (const tree of args.manifest.trees) {
    if (trees.get(tree.id)?.sourcePath !== tree.sourcePath) throw new Error(`the destination changed the captured identity of checkout ${tree.id}`)
  }
  const members = new Map(actual.threads.map((member) => [member.threadId, member]))
  if (members.size !== actual.threads.length || members.size !== expected.threads.length) throw new Error('the destination has an incomplete or duplicate family mapping')
  for (const member of expected.threads) {
    const restored = members.get(member.threadId)
    const homeTree = trees.get(member.home.treeId)
    if (restored === undefined || homeTree === undefined || restored.home !== joinTreePath({ treePath: homeTree.path, relativePath: member.home.relativePath })) throw new Error(`the destination changed the home mapping for ${member.threadId}`)
    if (member.active === null) {
      if (restored.active !== null) throw new Error(`the destination invented an active worktree for ${member.threadId}`)
      continue
    }
    const active = trees.get(member.active.treeId)
    if (active === undefined || restored.active === null || restored.active.path !== active.path || restored.active.branch !== (active.branch ?? 'HEAD') || restored.active.base !== member.active.base || restored.active.adopted !== member.active.adopted) throw new Error(`the destination changed the active mapping for ${member.threadId}`)
  }
  const checkouts = new Map(actual.checkouts.map((checkout) => [checkout.id, checkout]))
  if (checkouts.size !== actual.checkouts.length || checkouts.size !== expected.checkouts.length) throw new Error('the destination lost family-owned checkout generations')
  for (const checkout of expected.checkouts) {
    const restored = checkouts.get(checkout.id)
    if (restored?.path !== trees.get(checkout.treeId)?.path || restored?.claimedBy !== checkout.claimedBy) throw new Error(`the destination changed ownership of checkout generation ${checkout.id}`)
  }
}
