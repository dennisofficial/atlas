import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import type { LogPort } from '@dltech/atlas-core'

import { logFieldsOf } from '../logs'
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
  await mkdir(dirname(lockFile), { recursive: true })
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

async function readLock({
  lockFile,
  label,
  logPort,
}: {
  lockFile: string
  label?: string | undefined
  logPort?: LogPort | undefined
}): Promise<LockContents | undefined> {
  try {
    const parsed = lockContentsSchema.safeParse(JSON.parse(await readFile(lockFile, 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch (error) {
    if (errorCodeOf({ error }) !== 'ENOENT') {
      logPort?.warn({
        source: 'store.lock',
        message: 'could not read the session lock file',
        data: { path: lockFile, ...(label === undefined ? {} : { label }) },
        ...logFieldsOf({ error }),
      })
    }
    return undefined
  }
}

function warnSwallowed({
  logPort,
  lockFile,
  label,
  message,
  error,
}: {
  logPort: LogPort | undefined
  lockFile: string
  label: string
  message: string
  error: unknown
}): void {
  logPort?.warn({
    source: 'store.lock',
    message,
    data: { path: lockFile, label },
    ...logFieldsOf({ error }),
  })
}

function errorCodeOf({ error }: { error: unknown }): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export async function claimSession({
  sessionDir,
  lockFile,
  label,
  logPort,
}: {
  sessionDir: string
  lockFile: string
  label: string
  logPort?: LogPort | undefined
}): Promise<SessionClaim> {
  const claimed = await writeOwnLock({ lockFile, label })
  if (claimed !== undefined) return { claim: ESessionClaim.Owned, heldBy: claimed.pid, note: undefined }

  const existing = await readLock({ lockFile, label, logPort })
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

  await unlink(lockFile).catch((error) =>
    warnSwallowed({ logPort, lockFile, label, message: 'could not remove a stale session lock file', error }),
  )
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
  logPort,
}: {
  lockFile: string
  logPort?: LogPort | undefined
}): Promise<boolean> {
  const existing = await readLock({ lockFile, logPort })
  if (existing === undefined || existing.pid !== process.pid) return false
  try {
    await unlink(lockFile)
    return true
  } catch (error) {
    logPort?.warn({
      source: 'store.lock',
      message: 'could not release the session lock file',
      data: { path: lockFile },
      ...logFieldsOf({ error }),
    })
    return false
  }
}
