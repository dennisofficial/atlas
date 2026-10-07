import { readFile, realpath, stat } from 'node:fs/promises'
import { relative, sep } from 'node:path'

import type { Worktree } from '../worktrees-parse'
import { assertFamilyManifest, type WorkspaceFamily, type WorkspaceFamilyCapture } from './family-manifest'
import { absoluteGitDir } from './git-state'

export const CHECKOUT_MARKER = 'atlas-checkout-id'

export type CanonicalFamily = {
  rootId: string
  checkouts: { id: string; path: string; claimedBy: string }[]
  threads: {
    threadId: string
    home: string
    active: { path: string; base: string | null; adopted: boolean } | null
  }[]
}

const isInside = ({ parent, child }: { parent: string; child: string }): boolean =>
  child === parent || child.startsWith(`${parent}${sep}`)

const resolveExisting = async ({ path, what }: { path: string; what: string }): Promise<string> =>
  realpath(path).catch(() => {
    throw new Error(`Family ${what} ${path} no longer exists`)
  })

async function canonicalCheckouts({ family }: { family: WorkspaceFamilyCapture }): Promise<CanonicalFamily['checkouts']> {
  const unique: CanonicalFamily['checkouts'] = []
  for (const checkout of family.checkouts) {
    const path = await resolveExisting({ path: checkout.path, what: 'checkout' })
    const same = unique.find((entry) => entry.id === checkout.id || entry.path === path)
    if (same === undefined) {
      unique.push({ id: checkout.id, path, claimedBy: checkout.claimedBy })
      continue
    }
    if (same.id !== checkout.id || same.path !== path || same.claimedBy !== checkout.claimedBy) {
      throw new Error(`Family lists checkout ${checkout.id} at ${path} inconsistently`)
    }
  }
  return unique
}

async function canonicalThreads({ family }: { family: WorkspaceFamilyCapture }): Promise<CanonicalFamily['threads']> {
  const threads: CanonicalFamily['threads'] = []
  for (const thread of family.threads) {
    const home = await resolveExisting({ path: thread.home, what: `home of thread ${thread.threadId}` })
    if (!(await stat(home)).isDirectory()) throw new Error(`Home ${home} of thread ${thread.threadId} is not a directory`)
    const active =
      thread.active === null
        ? null
        : {
            path: await resolveExisting({ path: thread.active.path, what: `active tree of thread ${thread.threadId}` }),
            base: thread.active.base ?? null,
            adopted: thread.active.adopted,
          }
    threads.push({ threadId: thread.threadId, home, active })
  }
  return threads
}

export const canonicalizeFamily = async ({ family }: { family: WorkspaceFamilyCapture }): Promise<CanonicalFamily> => ({
  rootId: family.rootId,
  checkouts: await canonicalCheckouts({ family }),
  threads: await canonicalThreads({ family }),
})

const containing = ({ worktrees, path }: { worktrees: readonly Worktree[]; path: string }): Worktree | undefined =>
  worktrees
    .filter((worktree) => isInside({ parent: worktree.path, child: path }))
    .sort((left, right) => right.path.length - left.path.length)[0]

async function assertGeneration({ worktree, id }: { worktree: Worktree; id: string }): Promise<void> {
  if (worktree.isBare || worktree.isPrunable) {
    throw new Error(`Cannot capture owned checkout ${worktree.path}: it is ${worktree.isBare ? 'a bare repository' : 'missing on disk (prunable)'}`)
  }
  const gitDir = await absoluteGitDir({ cwd: worktree.path })
  const marker = await readFile(`${gitDir}/${CHECKOUT_MARKER}`, 'utf8').catch(() => null)
  if (marker === null || marker.trim() !== id) {
    throw new Error(`Owned checkout ${worktree.path} is not generation ${id}; it was recreated or is no longer the claimed checkout`)
  }
}

export async function selectFamilyWorktrees({
  worktrees,
  family,
}: {
  worktrees: readonly Worktree[]
  family: CanonicalFamily
}): Promise<Worktree[]> {
  const main = worktrees.find((worktree) => worktree.isMain)
  if (main === undefined) throw new Error('The repository has no main worktree to capture')
  if (main.isBare || main.isPrunable) throw new Error(`Cannot capture worktree ${main.path}: it is ${main.isBare ? 'a bare repository' : 'missing on disk (prunable)'}`)
  const owned = new Map<string, Worktree>()
  for (const checkout of family.checkouts) {
    const worktree = worktrees.find((candidate) => candidate.path === checkout.path)
    if (worktree === undefined) throw new Error(`Owned checkout ${checkout.path} is no longer a registered worktree`)
    if (worktree.isMain) throw new Error(`Owned checkout ${checkout.path} is the main worktree`)
    await assertGeneration({ worktree, id: checkout.id })
    owned.set(worktree.path, worktree)
  }
  const assertCovered = ({ worktree, what }: { worktree: Worktree | undefined; what: string }): void => {
    if (worktree === undefined) throw new Error(`${what} is outside every registered worktree`)
    if (!worktree.isMain && !owned.has(worktree.path)) {
      throw new Error(`${what} is in checkout ${worktree.path}, which the family does not own`)
    }
  }
  for (const thread of family.threads) {
    assertCovered({ worktree: containing({ worktrees, path: thread.home }), what: `Home ${thread.home} of thread ${thread.threadId}` })
    if (thread.active === null) continue
    const exact = worktrees.find((worktree) => worktree.path === thread.active?.path)
    assertCovered({ worktree: exact, what: `Active tree ${thread.active.path} of thread ${thread.threadId}` })
  }
  return [main, ...worktrees.filter((worktree) => owned.has(worktree.path))]
}

export function familyManifestOf({
  family,
  trees,
  plain,
}: {
  family: CanonicalFamily
  trees: readonly { id: string; sourcePath: string; isMain: boolean }[]
  plain: boolean
}): WorkspaceFamily {
  const treeAt = (path: string): { id: string; sourcePath: string } => {
    const tree = trees
      .filter((candidate) => isInside({ parent: candidate.sourcePath, child: path }))
      .sort((left, right) => right.sourcePath.length - left.sourcePath.length)[0]
    if (tree === undefined) throw new Error(`${path} is outside every captured tree`)
    return tree
  }
  const exactTree = (path: string): string => {
    const tree = trees.find((candidate) => candidate.sourcePath === path)
    if (tree === undefined) throw new Error(`${path} is not a captured tree`)
    return tree.id
  }
  const manifest: WorkspaceFamily = {
    rootId: family.rootId,
    checkouts: family.checkouts.map((checkout) => ({ id: checkout.id, treeId: exactTree(checkout.path), claimedBy: checkout.claimedBy })),
    threads: family.threads.map((thread) => {
      const home = treeAt(thread.home)
      return {
        threadId: thread.threadId,
        home: { treeId: home.id, relativePath: relative(home.sourcePath, thread.home).split(sep).join('/') },
        active: thread.active === null ? null : { treeId: exactTree(thread.active.path), base: thread.active.base, adopted: thread.active.adopted },
      }
    }),
  }
  assertFamilyManifest({ trees, family: manifest, plain })
  return manifest
}
