import { EExecutionLocation, ELocationChangeCause, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { WireSandboxListEntry } from '@dltech/atlas-harness'

import { messageOf } from '../error-text'

export const SANDBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const REAPER_LIST_FAILURE_NOTICE_MS = 24 * 60 * 60 * 1000

export type ReapedThread = { executionLocation?: EExecutionLocation | undefined }

export type ReaperListFailureMark = {
  readonly message: string
  readonly notifiedAt: number
}

export type SandboxReaper = {
  listSandboxes: () => Promise<WireSandboxListEntry[]>
  destroySandbox: (args: { threadId: string }) => Promise<void>
  destroyDrive: (args: { name: string; threadId: string }) => Promise<void>
  findThread: (args: { threadId: ThreadId }) => Promise<ReapedThread | undefined>
  flipToHost: (args: { threadId: ThreadId }) => Promise<void>
  recordExpired: (args: { threadId: ThreadId }) => Promise<void>
  notify: (text: string) => void
  readListFailureMark?: () => Promise<ReaperListFailureMark | null>
  writeListFailureMark?: (args: { mark: ReaperListFailureMark }) => Promise<void>
  clearListFailureMark?: () => Promise<void>
  now?: number | undefined
  ttlMs?: number | undefined
}

const reapOne = async (args: {
  row: WireSandboxListEntry
  reaper: SandboxReaper
}): Promise<void> => {
  const { row, reaper } = args
  try {
    await reaper.destroyDrive({ name: row.name, threadId: row.threadId })
    await reaper.destroySandbox({ threadId: row.threadId })
    const thread = await reaper.findThread({ threadId: toThreadId(row.threadId) })
    if (thread?.executionLocation === EExecutionLocation.Cloud) {
      await reaper.flipToHost({ threadId: toThreadId(row.threadId) })
      await reaper.recordExpired({ threadId: toThreadId(row.threadId) })
    }
  } catch (failure) {
    reaper.notify(
      `could not retire the expired cloud sandbox for "${row.threadId}": ${messageOf(failure)} — it keeps billing until it is destroyed.`,
    )
  }
}

const notifyListFailure = async (args: {
  reaper: SandboxReaper
  message: string
  now: number
}): Promise<void> => {
  const { reaper, message, now } = args
  if (reaper.readListFailureMark === undefined || reaper.writeListFailureMark === undefined) {
    reaper.notify(`the cloud sandbox reaper could not list sandboxes: ${message}`)
    return
  }

  try {
    const previous = await reaper.readListFailureMark()
    if (
      previous !== null &&
      previous.message === message &&
      now - previous.notifiedAt < REAPER_LIST_FAILURE_NOTICE_MS
    ) {
      return
    }
    await reaper.writeListFailureMark({ mark: { message, notifiedAt: now } })
    reaper.notify(`the cloud sandbox reaper could not list sandboxes: ${message}`)
  } catch {
    reaper.notify(`the cloud sandbox reaper could not list sandboxes: ${message}`)
  }
}

const clearListFailureMarkQuietly = async (reaper: SandboxReaper): Promise<void> => {
  if (reaper.clearListFailureMark === undefined) return
  try {
    await reaper.clearListFailureMark()
  } catch {}
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

  let rows: WireSandboxListEntry[]
  try {
    rows = await reaper.listSandboxes()
  } catch (failure) {
    await notifyListFailure({ reaper, message: messageOf(failure), now })
    return
  }
  await clearListFailureMarkQuietly(reaper)

  for (const row of rows) {
    const lastActivityAt = Date.parse(row.lastActivityAt)
    if (Number.isNaN(lastActivityAt) || now - lastActivityAt <= ttlMs) continue
    await reapOne({ row, reaper })
  }
}
