import { describe, expect, it } from 'bun:test'

import {
  latestRelease,
  parseMirrorTags,
  releaseNotice,
  releaseStaged,
  RELEASE_TAG_PREFIX,
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

describe('parseMirrorTags', () => {
  it('reads the tag list the mirror publishes', () => {
    expect(parseMirrorTags({ latest: 'tui-v0.3.0', tags: ['tui-v0.3.0', 'web-ota'] })).toEqual([
      'tui-v0.3.0',
      'web-ota',
    ])
  })

  it('is null when the body carries no usable list, so the caller falls back to github', () => {
    expect(parseMirrorTags({ tags: [] })).toBeNull()
    expect(parseMirrorTags({ tags: [1, null, ''] })).toBeNull()
    expect(parseMirrorTags({})).toBeNull()
    expect(parseMirrorTags('tags')).toBeNull()
    expect(parseMirrorTags(null)).toBeNull()
  })
})
