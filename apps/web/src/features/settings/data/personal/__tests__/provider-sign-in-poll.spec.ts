import { describe, expect, it } from 'bun:test'

import { EProviderSignInPoll, type ProviderSignInPoll } from '@dltech/atlas-wire/web'

import { pollSignInUntilSettled } from '../provider-sign-in-poll'

const complete: ProviderSignInPoll = {
  status: EProviderSignInPoll.Complete,
  account: {
    id: 'a1',
    provider: 'openai',
    kind: 'oauth',
    label: 'x',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
} as unknown as ProviderSignInPoll

function run(args: {
  results: ProviderSignInPoll[]
  expiresInMs?: number
  cancelAfterWaits?: number
}) {
  let clock = 0
  const waits: number[] = []
  const queue = [...args.results]
  const settled = pollSignInUntilSettled({
    attemptId: 'att',
    intervalMs: 5000,
    expiresInMs: args.expiresInMs ?? 60_000,
    poll: async () => queue.shift() ?? { status: EProviderSignInPoll.Pending },
    wait: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    now: () => clock,
    isCancelled: () => args.cancelAfterWaits !== undefined && waits.length >= args.cancelAfterWaits,
  })
  return { settled, waits }
}

describe('pollSignInUntilSettled', () => {
  it('keeps polling while pending and returns completion', async () => {
    const { settled, waits } = run({
      results: [{ status: EProviderSignInPoll.Pending }, complete],
    })
    expect(await settled).toEqual(complete)
    expect(waits).toEqual([5000, 5000])
  })

  it('returns expired from the server', async () => {
    const { settled } = run({
      results: [{ status: EProviderSignInPoll.Expired }],
    })
    expect(await settled).toEqual({ status: EProviderSignInPoll.Expired })
  })

  it('expires locally once the deadline passes', async () => {
    const { settled } = run({ results: [], expiresInMs: 8000 })
    expect(await settled).toEqual({ status: EProviderSignInPoll.Expired })
  })

  it('returns null when cancelled', async () => {
    const { settled } = run({ results: [], cancelAfterWaits: 1 })
    expect(await settled).toBeNull()
  })
})
