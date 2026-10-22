import { ENoticeTone, NOTICE_WARN_MS } from '@dltech/atlas-core'

import { UserFileConflict } from '../cloud/user-files-client'

import type { TreeSyncContext } from './context'
import { MAX_USER_LAYER_FILE_BYTES, megabytes } from './limits'
import { readLocalFile } from './local-file'
import { warnSync } from './log'
import { pullPath } from './pull'

const MAX_PUSH_ATTEMPTS = 2
const TOMBSTONE_HASH = ''

function reportOversize(args: { ctx: TreeSyncContext; key: string; byteLength: number }): void {
  const { ctx, key } = args
  const label = `${ctx.layout.tree}/${key}`
  const message = `not syncing ${label} to Atlas Cloud: ${megabytes(args.byteLength)} MB is over the ${megabytes(MAX_USER_LAYER_FILE_BYTES)} MB limit`
  warnSync({ log: ctx.log, message })
  ctx.notice?.notify({
    key: `user-layer-oversize:${label}`,
    tone: ENoticeTone.Warn,
    ttlMs: NOTICE_WARN_MS,
    text: message,
  })
}

async function pushFile(args: { ctx: TreeSyncContext; key: string; path: string }): Promise<void> {
  const { ctx, key } = args
  const address = { tree: ctx.layout.tree, path: key }

  for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt += 1) {
    const local = await readLocalFile(args.path)
    if (!local.exists || local.text === null) return
    if (local.text.bytes.byteLength > MAX_USER_LAYER_FILE_BYTES) {
      reportOversize({ ctx, key, byteLength: local.text.bytes.byteLength })
      return
    }
    const synced = ctx.state.get(address)
    if (synced?.contentHash === local.text.hash) return

    try {
      const { revision } = await ctx.client.putUserFile({
        ...address,
        content: local.text.bytes,
        contentHash: local.text.hash,
        baseRevision: synced?.revision ?? 0,
      })
      ctx.state.set({ ...address, revision, contentHash: local.text.hash })
      return
    } catch (error) {
      if (!(error instanceof UserFileConflict)) throw error
      await pullPath({ ctx, path: key })
    }
  }
}

async function pushDeletion(args: {
  ctx: TreeSyncContext
  key: string
  revision: number
}): Promise<void> {
  const { ctx, key } = args
  const located = ctx.layout.locate(key)
  if (located === null) return
  const local = await readLocalFile(located.path)
  if (local.exists) return

  const address = { tree: ctx.layout.tree, path: key }
  try {
    const { revision } = await ctx.client.deleteUserFile({
      ...address,
      baseRevision: args.revision,
    })
    ctx.state.set({ ...address, revision, contentHash: TOMBSTONE_HASH })
  } catch (error) {
    if (!(error instanceof UserFileConflict)) throw error
    await pullPath({ ctx, path: key })
  }
}

export async function pushTree(ctx: TreeSyncContext): Promise<void> {
  const scanned = await ctx.layout.scan()

  for (const [key, path] of scanned) {
    try {
      await pushFile({ ctx, key, path })
    } catch (error) {
      warnSync({ log: ctx.log, message: `could not push ${ctx.layout.tree}/${key}`, error })
    }
  }

  for (const [key, entry] of ctx.state.entries({ tree: ctx.layout.tree })) {
    if (entry.contentHash === TOMBSTONE_HASH || scanned.has(key)) continue
    try {
      await pushDeletion({ ctx, key, revision: entry.revision })
    } catch (error) {
      warnSync({ log: ctx.log, message: `could not delete ${ctx.layout.tree}/${key}`, error })
    }
  }
}
