import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acquireStagingLock,
  installedNotice,
  latestReleasePathFor,
  publishLatestRelease,
  readLatestRelease,
  shouldPublishLatest,
} from '../latest-release-state'

let dir: string | null = null

const sandbox = async (): Promise<string> => {
  dir = await mkdtemp(join(tmpdir(), 'latest-release-'))
  return dir
}

afterEach(async () => {
  if (dir === null) return
  await rm(dir, { recursive: true, force: true })
  dir = null
})

describe('latestReleasePathFor', () => {
  it('names the shared state file inside the atlas home', () => {
    expect(latestReleasePathFor('/home/me/.atlas')).toBe('/home/me/.atlas/latest-release')
  })
})

describe('publishLatestRelease + readLatestRelease', () => {
  it('round-trips the record a discovering tile wrote', async () => {
    const path = latestReleasePathFor(await sandbox())
    await publishLatestRelease({ path, version: '1.3.0', tag: 'tui-v1.3.0' })

    const read = await readLatestRelease(path)
    expect(read?.version).toBe('1.3.0')
    expect(read?.tag).toBe('tui-v1.3.0')
    expect(read?.stagedBy).toBe(process.pid)
  })

  it('refuses a version with a leading v rather than writing an unreadable record', async () => {
    const path = latestReleasePathFor(await sandbox())
    await publishLatestRelease({ path, version: 'v1.3.0', tag: 'tui-v1.3.0' })

    expect(await readLatestRelease(path)).toBeNull()
  })

  it('refuses to write a version that will not parse', async () => {
    const path = latestReleasePathFor(await sandbox())
    await publishLatestRelease({ path, version: 'nope', tag: 'tui-vnope' })

    expect(await readLatestRelease(path)).toBeNull()
  })

  it('is null before any tile has published', async () => {
    expect(await readLatestRelease(latestReleasePathFor(await sandbox()))).toBeNull()
  })

  it('is null rather than throwing when the file holds garbage', async () => {
    const path = latestReleasePathFor(await sandbox())
    await Bun.write(path, 'this is not json')

    expect(await readLatestRelease(path)).toBeNull()
  })
})

describe('shouldPublishLatest', () => {
  it('publishes when nothing has been published yet', () => {
    expect(shouldPublishLatest({ candidate: '1.3.0', published: null })).toBe(true)
  })

  it('publishes a version ahead of the published one', () => {
    const published = { version: '1.2.0', tag: 'tui-v1.2.0', stagedBy: 1, writtenAtMs: 1 }
    expect(shouldPublishLatest({ candidate: '1.3.0', published })).toBe(true)
  })

  it('does not republish the same or an older version', () => {
    const published = { version: '1.3.0', tag: 'tui-v1.3.0', stagedBy: 1, writtenAtMs: 1 }
    expect(shouldPublishLatest({ candidate: '1.3.0', published })).toBe(false)
    expect(shouldPublishLatest({ candidate: '1.2.9', published })).toBe(false)
  })

  it('republishes over a record whose version will not parse', () => {
    const published = { version: 'garbage', tag: 'tui-vgarbage', stagedBy: 1, writtenAtMs: 1 }
    expect(shouldPublishLatest({ candidate: '1.3.0', published })).toBe(true)
  })
})

describe('installedNotice', () => {
  it('points at /restart in green-ink wording', () => {
    expect(installedNotice('1.3.0')).toBe('atlas v1.3.0 installed — /restart to update')
  })
})

describe('acquireStagingLock', () => {
  it('lets one tile hold the lock and refuses the second', async () => {
    const path = latestReleasePathFor(await sandbox())

    const first = await acquireStagingLock({ path })
    const second = await acquireStagingLock({ path })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('hands the lock on once the holder releases it', async () => {
    const path = latestReleasePathFor(await sandbox())

    const first = await acquireStagingLock({ path })
    await first?.release()

    expect(await acquireStagingLock({ path })).not.toBeNull()
  })

  it('breaks a lock left behind by a tile that died mid-download', async () => {
    const path = latestReleasePathFor(await sandbox())
    const startedAtMs = 1_000_000

    await acquireStagingLock({ path, nowMs: startedAtMs })

    const recovered = await acquireStagingLock({
      path,
      nowMs: startedAtMs + 11 * 60 * 1000,
      staleAfterMs: 10 * 60 * 1000,
    })
    expect(recovered).not.toBeNull()
  })

  it('leaves a fresh lock alone', async () => {
    const path = latestReleasePathFor(await sandbox())
    const startedAtMs = 1_000_000

    await acquireStagingLock({ path, nowMs: startedAtMs })

    const refused = await acquireStagingLock({
      path,
      nowMs: startedAtMs + 60 * 1000,
      staleAfterMs: 10 * 60 * 1000,
    })
    expect(refused).toBeNull()
  })
})
