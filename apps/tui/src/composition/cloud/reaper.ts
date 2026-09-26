import { EExecutionLocation, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { WireSandboxListEntry } from '@dltech/atlas-harness'

import { messageOf } from '../error-text'

export const SANDBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type ReapedThread = { executionLocation?: EExecutionLocation | undefined }

export type SandboxReaper = {
  listSandboxes: () => Promise<WireSandboxListEntry[]>
  destroySandbox: (args: { threadId: string }) => Promise<void>
  destroyDrive: (args: { name: string; threadId: string }) => Promise<void>
  findThread: (args: { threadId: ThreadId }) => Promise<ReapedThread | undefined>
  flipToHost: (args: { threadId: ThreadId }) => Promise<void>
  notify: (text: string) => void
  now?: number | undefined
  ttlMs?: number | undefined
}

const expiredNotice = (args: { threadId: string; days: number }): string =>
  `the cloud workspace for "${args.threadId}" expired after ${args.days} days idle — the sandbox, its drive, and any turns that ran in the cloud are gone; the conversation continues from the local transcript.`

const reapOne = async (args: {
  row: WireSandboxListEntry
  reaper: SandboxReaper
  days: number
}): Promise<void> => {
  const { row, reaper } = args
  try {
    await reaper.destroyDrive({ name: row.name, threadId: row.threadId })
    await reaper.destroySandbox({ threadId: row.threadId })
    const thread = await reaper.findThread({ threadId: toThreadId(row.threadId) })
    if (thread?.executionLocation === EExecutionLocation.Cloud) {
      await reaper.flipToHost({ threadId: toThreadId(row.threadId) })
    }
    reaper.notify(expiredNotice({ threadId: row.threadId, days: args.days }))
  } catch (failure) {
    reaper.notify(
      `could not retire the expired cloud sandbox for "${row.threadId}": ${messageOf(failure)} — it keeps billing until it is destroyed.`,
    )
  }
}

/**
 * A thread that went quiet has no terminal event, but its drive bills forever — so the TUI, the
 * one place holding both the operator's Vercel credentials and the cloud session, retires idle
 * sandboxes on startup. Every row is independent and nothing here throws: a reaper failure must
 * never break the boot it rides on.
 */
export async function reapExpiredCloudSandboxes(reaper: SandboxReaper): Promise<void> {
  const now = reaper.now ?? Date.now()
  const ttlMs = reaper.ttlMs ?? SANDBOX_TTL_MS
  const days = Math.round(ttlMs / (24 * 60 * 60 * 1000))

  let rows: WireSandboxListEntry[]
  try {
    rows = await reaper.listSandboxes()
  } catch (failure) {
    reaper.notify(`the cloud sandbox reaper could not list sandboxes: ${messageOf(failure)}`)
    return
  }

  for (const row of rows) {
    const lastActivityAt = Date.parse(row.lastActivityAt)
    if (Number.isNaN(lastActivityAt) || now - lastActivityAt <= ttlMs) continue
    await reapOne({ row, reaper, days })
  }
}
