import { open, rename, rm } from 'node:fs/promises'

import { formatSemver, isNewerSemver, parseSemver } from '@dltech/atlas-core'

export const LATEST_RELEASE_FILENAME = 'latest-release'

export type LatestRelease = {
  readonly version: string
  readonly tag: string
  readonly stagedBy: number
  readonly writtenAtMs: number
}

export function latestReleasePathFor(atlasHome: string): string {
  return `${atlasHome}/${LATEST_RELEASE_FILENAME}`
}

const parseLatestRelease = (raw: string): LatestRelease | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.version !== 'string') return null
  if (parseSemver(record.version) === null) return null
  if (typeof record.tag !== 'string' || record.tag.length === 0) return null
  if (typeof record.stagedBy !== 'number') return null
  if (typeof record.writtenAtMs !== 'number') return null

  return {
    version: record.version,
    tag: record.tag,
    stagedBy: record.stagedBy,
    writtenAtMs: record.writtenAtMs,
  }
}

export async function readLatestRelease(path: string): Promise<LatestRelease | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return null

  try {
    return parseLatestRelease(await file.text())
  } catch {
    return null
  }
}

export function shouldPublishLatest(args: {
  candidate: string
  published: LatestRelease | null
}): boolean {
  const candidate = parseSemver(args.candidate)
  if (candidate === null) return false

  if (args.published === null) return true
  const published = parseSemver(args.published.version)
  if (published === null) return true

  return isNewerSemver({ candidate, current: published })
}

export function installedNotice(version: string): string {
  return `atlas v${version} installed — /restart to update`
}

export async function publishLatestRelease(args: {
  path: string
  version: string
  tag: string
}): Promise<void> {
  const parsed = parseSemver(args.version)
  if (parsed === null) return

  const record: LatestRelease = {
    version: formatSemver(parsed),
    tag: args.tag,
    stagedBy: process.pid,
    writtenAtMs: Date.now(),
  }

  const tempPath = `${args.path}.${process.pid}.tmp`
  await Bun.write(tempPath, `${JSON.stringify(record)}\n`)
  await rename(tempPath, args.path)
}

const LOCK_STALE_MS = 10 * 60 * 1000

export type StagingLock = {
  readonly release: () => Promise<void>
}

export async function acquireStagingLock(args: {
  path: string
  staleAfterMs?: number
  nowMs?: number
}): Promise<StagingLock | null> {
  const staleAfterMs = args.staleAfterMs ?? LOCK_STALE_MS
  const nowMs = args.nowMs ?? Date.now()
  const lockPath = `${args.path}.lock`

  try {
    const handle = await open(lockPath, 'wx')
    try {
      await handle.writeFile(String(nowMs))
    } finally {
      await handle.close()
    }

    return {
      release: async () => {
        await rm(lockPath, { force: true })
      },
    }
  } catch {
    const file = Bun.file(lockPath)
    if (!(await file.exists())) return null

    const writtenAtMs = Number((await file.text()).trim())
    if (!Number.isNaN(writtenAtMs) && nowMs - writtenAtMs >= staleAfterMs) {
      await rm(lockPath, { force: true })
      return acquireStagingLock(args)
    }

    return null
  }
}
