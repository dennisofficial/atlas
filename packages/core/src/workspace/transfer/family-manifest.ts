import { z } from 'zod'

const TREE_ID = /^[a-zA-Z0-9_-]+$/
const WINDOWS_ESCAPE = /^[a-zA-Z]:|\\/

export type WorkspaceFamilyCapture = {
  rootId: string
  checkouts: { id: string; path: string; claimedBy: string }[]
  threads: {
    threadId: string
    home: string
    active: { path: string; branch: string; base: string | undefined; adopted: boolean } | null
  }[]
}

export type RestoredFamily = {
  rootId: string
  checkouts: { id: string; path: string; claimedBy: string }[]
  threads: {
    threadId: string
    home: string
    active: { path: string; branch: string; base: string | null; adopted: boolean } | null
  }[]
}

export const isSafeRelativePath = (path: string): boolean =>
  path === '' ||
  !(
    path.startsWith('/') ||
    path.includes('\0') ||
    WINDOWS_ESCAPE.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )

const treeId = z.string().regex(TREE_ID)

export const workspaceFamilySchema = z.object({
  rootId: z.string().min(1),
  checkouts: z.array(z.object({ id: z.string().min(1), treeId, claimedBy: z.string().min(1) })),
  threads: z.array(
    z.object({
      threadId: z.string().min(1),
      home: z.object({ treeId, relativePath: z.string().refine(isSafeRelativePath, 'unsafe home path') }),
      active: z.object({ treeId, base: z.string().nullable(), adopted: z.boolean() }).nullable(),
    }),
  ),
})

export type WorkspaceFamily = z.infer<typeof workspaceFamilySchema>

const duplicate = (values: readonly string[]): string | undefined =>
  values.find((value, index) => values.indexOf(value) !== index)

export function assertFamilyManifest({
  trees,
  family,
  plain,
}: {
  trees: readonly { id: string; isMain: boolean }[]
  family: WorkspaceFamily
  plain: boolean
}): void {
  const known = new Set(trees.map((tree) => tree.id))
  const mainIds = new Set(trees.filter((tree) => tree.isMain).map((tree) => tree.id))
  const repeatedCheckout = duplicate(family.checkouts.map((entry) => entry.id))
  if (repeatedCheckout !== undefined) throw new Error(`archive family repeats checkout ${repeatedCheckout}`)
  const repeatedTree = duplicate(family.checkouts.map((entry) => entry.treeId))
  if (repeatedTree !== undefined) throw new Error(`archive family maps two checkouts to tree ${repeatedTree}`)
  const repeatedThread = duplicate(family.threads.map((thread) => thread.threadId))
  if (repeatedThread !== undefined) throw new Error(`archive family repeats thread ${repeatedThread}`)
  if (!family.threads.some((thread) => thread.threadId === family.rootId)) {
    throw new Error(`archive family has no thread for its root ${family.rootId}`)
  }
  if (plain && family.checkouts.length > 0) throw new Error('archive family owns checkouts but has no repository')
  const owned = new Set(family.checkouts.map((entry) => entry.treeId))
  for (const entry of family.checkouts) {
    if (!known.has(entry.treeId) || mainIds.has(entry.treeId)) {
      throw new Error(`archive family checkout ${entry.id} names tree ${entry.treeId}, which is not a linked tree`)
    }
  }
  const isCovered = (id: string): boolean => known.has(id) && (mainIds.has(id) || owned.has(id))
  for (const thread of family.threads) {
    const mapped = [thread.home.treeId, ...(thread.active === null ? [] : [thread.active.treeId])]
    const missing = mapped.find((id) => !isCovered(id))
    if (missing !== undefined) throw new Error(`archive family thread ${thread.threadId} names unowned tree ${missing}`)
    if (plain && thread.active !== null) throw new Error(`archive family thread ${thread.threadId} has an active tree but no repository`)
  }
}
