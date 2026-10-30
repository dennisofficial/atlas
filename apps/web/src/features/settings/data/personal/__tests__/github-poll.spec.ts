import { describe, expect, it } from 'bun:test'

import {
  EGithubPollStatus,
  type GithubDeviceCodes,
  type GithubPollResult,
} from '@dltech/atlas-wire/web'

import { pollUntilSettled } from '../github-poll'

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
    const connected = { status: EGithubPollStatus.Connected, login: 'o', scopes: ['repo'] } as const
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
