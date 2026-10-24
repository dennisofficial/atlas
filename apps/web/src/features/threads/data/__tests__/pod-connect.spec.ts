import { afterEach, describe, expect, it } from 'bun:test'

import { CloudApiError } from '@/lib/cloud-api'

import { fakeFetch, mutationUrl, trpcFailure, trpcOk } from './trpc-fake'

import { connectPod, EPodConnectOutcome } from '../pod-connect'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('connectPod', () => {
  it('mutates threadPod.connect and returns the ticket', async () => {
    const ticket = {
      url: 'https://pod.test',
      token: 'ct1.payload.sig',
      expiresAt: '2026-10-22T10:01:00.000Z',
    }
    const calls = fakeFetch(() => trpcOk(ticket))

    const result = await connectPod('t 1')

    expect(result).toEqual({ outcome: EPodConnectOutcome.Ready, ticket })
    expect(calls).toEqual([
      { url: mutationUrl('threadPod.connect'), method: 'POST', body: { threadId: 't 1' } },
    ])
  })

  it('answers not-running instead of throwing on a 409 pod-not-running', async () => {
    fakeFetch(() =>
      trpcFailure({
        status: 409,
        message: 'not running',
        details: { code: 'pod-not-running', message: 'not running' },
      }),
    )

    expect(await connectPod('t1')).toEqual({ outcome: EPodConnectOutcome.NotRunning })
  })

  it('still throws on a 409 with another code', async () => {
    fakeFetch(() =>
      trpcFailure({ status: 409, details: { code: 'something-else', message: 'nope' } }),
    )

    await expect(connectPod('t1')).rejects.toBeInstanceOf(CloudApiError)
  })

  it('throws on a server error', async () => {
    fakeFetch(() => trpcFailure({ status: 500, message: 'boom' }))

    await expect(connectPod('t1')).rejects.toBeInstanceOf(CloudApiError)
  })
})
