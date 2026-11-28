import { describe, expect, it } from 'bun:test'

import {
  EGithubPollStatus,
  type GithubDeviceCodes,
  type GithubPollResult,
} from '@dltech/atlas-wire/web'

import { githubCapabilitiesOf, githubFailureOf, pollUntilSettled } from '../connect'

const codes: GithubDeviceCodes = {
  deviceCode: 'dc',
  userCode: 'ABCD-1234',
  verificationUrl: 'https://github.com/login/device',
  expiresInMs: 60_000,
  intervalMs: 5000,
}

function run(args: { results: GithubPollResult[]; expiresInMs?: number }) {
  let clock = 0
  const waits: number[] = []
  const queue = [...args.results]
  const settled = pollUntilSettled({
    codes: { ...codes, expiresInMs: args.expiresInMs ?? codes.expiresInMs },
    poll: async () => queue.shift() ?? { status: EGithubPollStatus.Pending },
    wait: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    now: () => clock,
    isCancelled: () => false,
  })
  return { settled, waits }
}

describe('pollUntilSettled', () => {
  it('keeps polling while pending and returns the connection', async () => {
    const connected: GithubPollResult = {
      status: EGithubPollStatus.Connected,
      login: 'o',
      scopes: ['repo'],
    }
    const { settled, waits } = run({ results: [{ status: EGithubPollStatus.Pending }, connected] })
    expect(await settled).toEqual(connected)
    expect(waits).toEqual([5000, 5000])
  })

  it('adds five seconds to the interval on slow_down', async () => {
    const { settled, waits } = run({
      results: [
        { status: EGithubPollStatus.SlowDown },
        { status: EGithubPollStatus.Pending },
        { status: EGithubPollStatus.Denied },
      ],
    })
    expect((await settled)?.status).toBe(EGithubPollStatus.Denied)
    expect(waits).toEqual([5000, 10_000, 10_000])
  })

  it('reports expiry once the code deadline passes', async () => {
    const { settled } = run({ results: [], expiresInMs: 12_000 })
    expect(await settled).toEqual({ status: EGithubPollStatus.Expired })
  })

  it('stops silently when cancelled', async () => {
    const result = await pollUntilSettled({
      codes,
      poll: async () => ({ status: EGithubPollStatus.Pending }),
      wait: async () => {},
      now: () => 0,
      isCancelled: () => true,
    })
    expect(result).toBeNull()
  })
})

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
