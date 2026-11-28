import { describe, expect, it } from 'bun:test'
import { EGithubPollStatus } from '@dltech/atlas-wire/web'
import { githubCapabilitiesOf, githubFailureOf } from '../connect'

describe('githubFailureOf', () => {
  it('names why the connection failed', () => {
    expect(githubFailureOf({ status: EGithubPollStatus.Denied })).toBe('GitHub access was refused')
    expect(
      githubFailureOf({ status: EGithubPollStatus.MissingScopes, missing: ['repo', 'read:org'] }),
    ).toBe("GitHub didn't grant repo, read:org. Approve every permission to continue.")
    expect(githubFailureOf({ status: EGithubPollStatus.Expired })).toBe('That code expired')
  })
})

describe('githubCapabilitiesOf', () => {
  it('grants nothing while disconnected', () => {
    expect(githubCapabilitiesOf({ connected: false })).toEqual([
      { label: 'Clone private repos', granted: false },
      { label: 'Open pull requests', granted: false },
      { label: 'Org-wide access', granted: false },
    ])
  })

  it('reads the granted scopes off the connection', () => {
    expect(
      githubCapabilitiesOf({
        connected: true,
        login: 'octocat',
        scopes: ['repo'],
        missingScopes: ['read:org'],
        connectedAt: '2026-11-27T00:00:00.000Z',
      }),
    ).toEqual([
      { label: 'Clone private repos', granted: true },
      { label: 'Open pull requests', granted: true },
      { label: 'Org-wide access', granted: false },
    ])
  })
})
