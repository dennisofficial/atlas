import { describe, expect, it } from 'bun:test'

import { payloadVersion } from '../payload-version'

const major = { major: 2, minor: 0, patch: 0, prerelease: null }
const next = { ...major, patch: 1 }

const resolve = (headTags: readonly string[]) => payloadVersion({ headTags, prefix: 'tui-v', next })

describe('the web payload version', () => {
  it('keeps the release version when the release job has already tagged HEAD', () => {
    expect(payloadVersion({ headTags: ['tui-v2.0.0'], prefix: 'tui-v', next: null })).toEqual(major)
    expect(resolve(['tui-v2.0.0'])).toEqual(major)
  })

  it('uses the computed next version before the release tag exists', () => {
    expect(resolve([])).toEqual(next)
  })

  it('ignores unrelated and malformed tags', () => {
    expect(resolve(['web-ota', 'other-v9.0.0', 'tui-vinvalid'])).toEqual(next)
  })

  it('selects the highest exact tag regardless of git tag order', () => {
    expect(resolve(['tui-v1.455.0', 'tui-v2.0.0', 'tui-v2.0.0-beta.1'])).toEqual(major)
  })

  it('preserves a non-release decision without a valid exact tag', () => {
    expect(payloadVersion({ headTags: [], prefix: 'tui-v', next: null })).toBeNull()
  })
})
