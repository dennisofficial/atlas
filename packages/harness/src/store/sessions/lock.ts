import { link, readFile, unlink, writeFile } from 'node:fs/promises'

import { z } from 'zod'

import { holderIsLive, ownIdentity } from '../../workspace/process-identity'

export enum ESessionClaim {
  Owned = 'owned',
  Reclaimed = 'reclaimed',
  Held = 'held',
  Guest = 'guest',
}

export type SessionClaim = {
  claim: ESessionClaim
  heldBy: number | undefined
  note: string | undefined
}

const lockContentsSchema = z.object({
  pid: z.number(),
  start: z.string().optional(),
  label: z.string(),
})

type LockContents = z.infer<typeof lockContentsSchema>

async function writeOwnLock({
  lockFile,
  label,
}: {
  lockFile: string
  label: string
}): Promise<LockContents | undefined> {
  const identity = await ownIdentity()
  const contents: LockContents = {
    pid: identity.pid,
    ...(identity.start === undefined ? {} : { start: identity.start }),
    label,
  }
  const tmp = `${lockFile}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(contents))
  try {
    await link(tmp, lockFile)
    return contents
  } catch {
    return undefined
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

async function readLock({ lockFile }: { lockFile: string }): Promise<LockContents | undefined> {
  try {
    const parsed = lockContentsSchema.safeParse(JSON.parse(await readFile(lockFile, 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export async function claimSession({
  sessionDir,
  lockFile,
  label,
}: {
  sessionDir: string
  lockFile: string
  label: string
}): Promise<SessionClaim> {
  const claimed = await writeOwnLock({ lockFile, label })
  if (claimed !== undefined) return { claim: ESessionClaim.Owned, heldBy: claimed.pid, note: undefined }

  const existing = await readLock({ lockFile })
  if (existing === undefined) {
    return {
      claim: ESessionClaim.Guest,
      heldBy: undefined,
      note: 'the lock file exists but is unreadable, so this session is opening it as a guest',
    }
  }

  if (existing.pid === process.pid) return { claim: ESessionClaim.Owned, heldBy: existing.pid, note: undefined }

  const live = await holderIsLive({ pid: existing.pid, start: existing.start })
  if (live) {
    return {
      claim: ESessionClaim.Held,
      heldBy: existing.pid,
      note: `session is open in another Atlas instance (${existing.label}, pid ${existing.pid})`,
    }
  }

  await unlink(lockFile).catch(() => {})
  const retaken = await writeOwnLock({ lockFile, label })
  if (retaken !== undefined) {
    return {
      claim: ESessionClaim.Reclaimed,
      heldBy: retaken.pid,
      note: 'the previous lock holder is no longer running, so the stale lock was reclaimed',
    }
  }

  return {
    claim: ESessionClaim.Held,
    heldBy: undefined,
    note: 'the stale lock was reclaimed by another instance first',
  }
}

export async function releaseSession({
  lockFile,
}: {
  lockFile: string
}): Promise<boolean> {
  const existing = await readLock({ lockFile })
  if (existing === undefined || existing.pid !== process.pid) return false
  try {
    await unlink(lockFile)
    return true
  } catch {
    return false
  }
}
