import { describe, expect, it } from 'bun:test'

import { installedNotice, type LatestRelease } from '../../build/latest-release-state'
import {
  createReleaseWatch,
  createSourceStaleness,
  latestRelease,
  releaseNotice,
  releaseStaged,
  RELEASE_TAG_PREFIX,
  SOURCE_STALE_NOTICE,
  sourceBehindNotice,
} from '../update-check'

describe('latestRelease', () => {
  it('picks the newest tag in the tui series and ignores the other apps', () => {
    const latest = latestRelease({
      tags: ['tui-v0.1.0', 'api-v9.9.9', 'tui-v0.3.2', 'tui-v0.3.10'],
      prefix: RELEASE_TAG_PREFIX,
    })

    expect(latest?.tag).toBe('tui-v0.3.10')
  })

  it('is null when nothing in the series has shipped', () => {
    expect(latestRelease({ tags: ['api-v1.0.0'], prefix: RELEASE_TAG_PREFIX })).toBeNull()
    expect(latestRelease({ tags: [], prefix: RELEASE_TAG_PREFIX })).toBeNull()
  })

  it('skips tags that carry no readable version', () => {
    const latest = latestRelease({ tags: ['tui-vnext', 'tui-v0.2.0'], prefix: RELEASE_TAG_PREFIX })

    expect(latest?.tag).toBe('tui-v0.2.0')
  })
})

describe('releaseNotice', () => {
  const latest = { tag: 'tui-v0.3.0', version: { major: 0, minor: 3, patch: 0, prerelease: null } }

  it('announces a release ahead of the one running', () => {
    expect(releaseNotice({ current: '0.2.0', latest })).toBe(
      'atlas update: v0.3.0 available (running v0.2.0)',
    )
  })

  it('stays quiet when the running build is the release or ahead of it', () => {
    expect(releaseNotice({ current: '0.3.0', latest })).toBeNull()
    expect(releaseNotice({ current: '0.3.1', latest })).toBeNull()
  })

  it('stays quiet rather than guess when the running version will not parse', () => {
    expect(releaseNotice({ current: 'dev', latest })).toBeNull()
  })
})

describe('sourceBehindNotice', () => {
  it('stays quiet while the checkout is even with its upstream', () => {
    expect(sourceBehindNotice({ behind: 0, upstream: 'origin/main' })).toBeNull()
  })

  it('names one commit as one commit', () => {
    expect(sourceBehindNotice({ behind: 1, upstream: 'origin/main' })).toContain('1 commit behind')
  })

  it('names the upstream it counted against', () => {
    const text = sourceBehindNotice({ behind: 4, upstream: 'origin/main' })

    expect(text).toContain('4 commits behind origin/main')
    expect(text).toContain('git pull')
  })
})

describe('releaseStaged', () => {
  it('is staged while the marker names a version ahead of what is running', () => {
    expect(releaseStaged({ running: '0.2.0', staged: '0.3.0' })).toBe(true)
  })

  it('is not staged once the running version has caught up to the marker', () => {
    expect(releaseStaged({ running: '0.3.0', staged: '0.3.0' })).toBe(false)
  })

  it('is not staged when the marker is left over from an older self-update', () => {
    expect(releaseStaged({ running: '0.3.0', staged: '0.2.0' })).toBe(false)
  })

  it('is not staged when nothing has been staged', () => {
    expect(releaseStaged({ running: '0.2.0', staged: null })).toBe(false)
  })

  it('is not staged when the marker cannot be read as a version', () => {
    expect(releaseStaged({ running: '0.2.0', staged: 'not-a-version' })).toBe(false)
  })
})

describe('createSourceStaleness', () => {
  const recorder = (): { posted: string[]; announce: (text: string) => void } => {
    const posted: string[] = []
    return { posted, announce: (text) => posted.push(text) }
  }

  it('stays quiet while the tree matches the launch stamp', async () => {
    const { posted, announce } = recorder()
    const staleness = createSourceStaleness({
      launchStamp: 'a',
      readStamp: async () => 'a',
      announce,
    })

    await staleness.check()

    expect(posted).toEqual([])
  })

  it('announces once the tree moves off the launch stamp', async () => {
    const { posted, announce } = recorder()
    const staleness = createSourceStaleness({
      launchStamp: 'a',
      readStamp: async () => 'b',
      announce,
    })

    await staleness.check()

    expect(posted).toEqual([SOURCE_STALE_NOTICE])
  })

  it('announces once however many turns end', async () => {
    const { posted, announce } = recorder()
    const staleness = createSourceStaleness({
      launchStamp: 'a',
      readStamp: async () => 'b',
      announce,
    })

    await staleness.check()
    await staleness.check()
    await staleness.check()

    expect(posted).toHaveLength(1)
  })

  it('says nothing while the stamp cannot be read, and still announces once it can', async () => {
    const { posted, announce } = recorder()
    let stamp: string | null = null
    const staleness = createSourceStaleness({
      launchStamp: 'a',
      readStamp: async () => stamp,
      announce,
    })

    await staleness.check()
    expect(posted).toEqual([])

    stamp = 'b'
    await staleness.check()
    expect(posted).toEqual([SOURCE_STALE_NOTICE])
  })

  it('reports movement through stale() without announcing it', async () => {
    const { posted, announce } = recorder()
    let stamp: string | null = 'a'
    const staleness = createSourceStaleness({
      launchStamp: 'a',
      readStamp: async () => stamp,
      announce,
    })

    expect(await staleness.stale()).toBe(false)

    stamp = 'b'
    expect(await staleness.stale()).toBe(true)
    expect(posted).toEqual([])

    stamp = null
    expect(await staleness.stale()).toBe(false)
  })
})

describe('createReleaseWatch', () => {
  const staged = (version: string): LatestRelease => ({
    version,
    tag: `tui-v${version}`,
    stagedBy: 42,
    writtenAtMs: 1,
  })

  const recorder = (): { posted: string[]; announce: (text: string) => void } => {
    const posted: string[] = []
    return { posted, announce: (text) => posted.push(text) }
  }

  it('announces the installed notice once the shared file names a newer version', async () => {
    const { posted, announce } = recorder()
    const watch = createReleaseWatch({
      running: '1.2.0',
      read: async () => staged('1.3.0'),
      announce,
    })

    await watch.check()

    expect(posted).toEqual([installedNotice('1.3.0')])
  })

  it('stays quiet while the shared file names nothing newer than the running build', async () => {
    const { posted, announce } = recorder()
    const watch = createReleaseWatch({
      running: '1.3.0',
      read: async () => staged('1.3.0'),
      announce,
    })

    await watch.check()

    expect(posted).toEqual([])
  })

  it('stays quiet while no tile has published anything', async () => {
    const { posted, announce } = recorder()
    const watch = createReleaseWatch({
      running: '1.2.0',
      read: async () => null,
      announce,
    })

    await watch.check()

    expect(posted).toEqual([])
  })

  it('announces once per version however often the settle loop fires', async () => {
    const { posted, announce } = recorder()
    const watch = createReleaseWatch({
      running: '1.2.0',
      read: async () => staged('1.3.0'),
      announce,
    })

    await watch.check()
    await watch.check()
    await watch.check()

    expect(posted).toHaveLength(1)
  })

  it('announces again when a newer release lands after an earlier one', async () => {
    const { posted, announce } = recorder()
    let version = '1.3.0'
    const watch = createReleaseWatch({
      running: '1.2.0',
      read: async () => staged(version),
      announce,
    })

    await watch.check()
    version = '1.4.0'
    await watch.check()

    expect(posted).toEqual([installedNotice('1.3.0'), installedNotice('1.4.0')])
  })
})
