import { conflictCopyName, mergeMemoryIndexes } from '@dltech/atlas-core'

import type { UserFileContent } from '../cloud/user-files-client'

import type { TreeSyncContext } from './context'
import { isConflictCopyKey, isMemoryIndexKey } from './layout'
import {
  decodeText,
  readLocalFile,
  removeLocalFile,
  writeLocalFile,
  type LocalRead,
  type LocalText,
} from './local-file'
import { warnSync } from './log'

const TOMBSTONE_HASH = ''

async function preserveLocal(args: { path: string; text: LocalText; deviceId: string }): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const copy = conflictCopyName({
      path: args.path,
      deviceId: attempt === 1 ? args.deviceId : `${args.deviceId}-${attempt}`,
    })
    const existing = await readLocalFile(copy)
    if (!existing.exists) {
      await writeLocalFile({ path: copy, content: args.text.content })
      return
    }
    if (existing.text?.hash === args.text.hash) return
  }
}

type RowContext = {
  ctx: TreeSyncContext
  row: UserFileContent
  path: string
  local: LocalRead & { exists: true } | { exists: false }
}

async function applyTombstone(args: RowContext): Promise<void> {
  const { ctx, row, local } = args
  const key = { tree: ctx.layout.tree, path: row.path }
  const tombstoned = { ...key, revision: row.revision, contentHash: TOMBSTONE_HASH }
  const synced = ctx.state.get(key)

  const neverSyncedHere = synced === undefined || synced.contentHash === TOMBSTONE_HASH
  if (!local.exists || local.text === null || neverSyncedHere) {
    ctx.state.set(tombstoned)
    return
  }

  if (local.text.hash !== synced.contentHash) {
    await preserveLocal({ path: args.path, text: local.text, deviceId: ctx.state.deviceId })
  }
  await removeLocalFile(args.path)
  ctx.state.set(tombstoned)
}

async function applyLive(args: RowContext): Promise<void> {
  const { ctx, row, local, path } = args
  const key = { tree: ctx.layout.tree, path: row.path }
  const remoteText = row.content === null ? null : decodeText(row.content)
  if (remoteText === null) return

  const accepted = { ...key, revision: row.revision, contentHash: row.contentHash }
  if (local.exists && local.text === null) return
  const localText = local.exists ? (local.text ?? undefined) : undefined

  if (localText?.hash === row.contentHash) {
    ctx.state.set(accepted)
    return
  }

  const synced = ctx.state.get(key)
  const localUnchanged = localText === undefined || localText.hash === synced?.contentHash
  if (localUnchanged) {
    await writeLocalFile({ path, content: remoteText })
    ctx.state.set(accepted)
    return
  }

  if (isMemoryIndexKey(row.path)) {
    const merged = mergeMemoryIndexes({ local: localText.content, remote: remoteText, prefer: 'remote' })
    await writeLocalFile({ path, content: merged })
    ctx.state.set(accepted)
    return
  }

  await preserveLocal({ path, text: localText, deviceId: ctx.state.deviceId })
  await writeLocalFile({ path, content: remoteText })
  ctx.state.set(accepted)
}

export async function applyRemoteRows(args: {
  ctx: TreeSyncContext
  rows: readonly UserFileContent[]
}): Promise<void> {
  const { ctx } = args
  for (const row of args.rows) {
    if (isConflictCopyKey(row.path)) continue
    const located = ctx.layout.locate(row.path)
    if (located === null) continue

    try {
      const local = await readLocalFile(located.path)
      const rowContext = { ctx, row, path: located.path, local }
      if (row.tombstonedAt === null) await applyLive(rowContext)
      else await applyTombstone(rowContext)
    } catch (error) {
      warnSync({ log: ctx.log, message: `could not apply ${ctx.layout.tree}/${row.path}`, error })
    }
  }
}
