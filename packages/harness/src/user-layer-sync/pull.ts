import { isValidTreePath } from '@dltech/atlas-core'

import type { UserFileContent, UserFileMeta } from '../cloud/user-files-client'

import { applyRemoteRows } from './apply'
import type { TreeSyncContext } from './context'
import { isConflictCopyKey } from './layout'

const MAX_PATHS_PER_GET = 500

const chunked = <T>(items: readonly T[]): readonly (readonly T[])[] => {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += MAX_PATHS_PER_GET) {
    chunks.push(items.slice(start, start + MAX_PATHS_PER_GET))
  }
  return chunks
}

const isAdvanced = (args: { ctx: TreeSyncContext; meta: UserFileMeta }): boolean =>
  isValidTreePath(args.meta.path) &&
  !isConflictCopyKey(args.meta.path) &&
  args.ctx.state.get({ tree: args.ctx.layout.tree, path: args.meta.path })?.revision !== args.meta.revision

export async function pullTree(ctx: TreeSyncContext): Promise<void> {
  const listing = await ctx.client.listUserFiles({ tree: ctx.layout.tree })
  const advanced = listing.filter((meta) => isAdvanced({ ctx, meta }))

  const tombstones: UserFileContent[] = advanced
    .filter((meta) => meta.tombstonedAt !== null)
    .map((meta) => ({ ...meta, content: null }))

  const fetched: UserFileContent[] = []
  const livePaths = advanced.filter((meta) => meta.tombstonedAt === null).map((meta) => meta.path)
  for (const paths of chunked(livePaths)) {
    fetched.push(...(await ctx.client.getUserFiles({ tree: ctx.layout.tree, paths })))
  }

  await applyRemoteRows({ ctx, rows: [...tombstones, ...fetched] })
}

export async function pullPath(args: { ctx: TreeSyncContext; path: string }): Promise<void> {
  const rows = await args.ctx.client.getUserFiles({ tree: args.ctx.layout.tree, paths: [args.path] })
  await applyRemoteRows({ ctx: args.ctx, rows })
}
