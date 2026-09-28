import { describe, expect, it } from 'vitest'
import { parseHookRepoParam, payloadFieldsOf } from './github-pr-payload'

const PULL = {
  number: 42,
  title: 'add the thing',
  html_url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  draft: false,
  merged_at: null,
  head: { ref: 'dennis/add-the-thing', sha: 'abc123' },
}

describe('payloadFieldsOf', () => {
  it('maps an open pull_request payload to last-known state', () => {
    const fields = payloadFieldsOf({ pull: PULL })

    expect(fields).toMatchObject({
      title: 'add the thing',
      state: 'open',
      headBranch: 'dennis/add-the-thing',
      headSha: 'abc123',
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
      mergeable: null,
    })
  })

  it('maps a draft PR', () => {
    expect(payloadFieldsOf({ pull: { ...PULL, draft: true } }).state).toBe('draft')
  })

  it('maps a merged PR', () => {
    expect(
      payloadFieldsOf({ pull: { ...PULL, state: 'closed', merged_at: '2026-09-28T00:00:00Z' } })
        .state,
    ).toBe('merged')
  })

  it('maps a closed-unmerged PR', () => {
    expect(payloadFieldsOf({ pull: { ...PULL, state: 'closed' } }).state).toBe('closed')
  })
})

describe('parseHookRepoParam', () => {
  it('parses owner/repo', () => {
    expect(parseHookRepoParam({ repo: 'compai/app' })).toBe('compai/app')
  })

  it('decodes an encoded slash', () => {
    expect(parseHookRepoParam({ repo: 'compai%2Fapp' })).toBe('compai/app')
  })

  it('rejects anything that is not owner/repo', () => {
    expect(parseHookRepoParam({ repo: 'compai' })).toBeNull()
    expect(parseHookRepoParam({ repo: 'a/b/c' })).toBeNull()
    expect(parseHookRepoParam({ repo: '/app' })).toBeNull()
  })
})
