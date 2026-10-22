import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { CloudApiError } from '@/lib/cloud-api'

import { connectPod, EPodConnectOutcome } from '../pod-connect'

type Call = { url: string; method: string | undefined }

let calls: Call[]
let reply: { status: number; body: unknown }
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  reply = { status: 200, body: {} }
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method })
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('connectPod', () => {
  it('posts to the thread pod connect path and returns the ticket on 200', async () => {
    const ticket = {
      url: 'https://pod.test',
      token: 'ct1.payload.sig',
      expiresAt: '2026-10-22T10:01:00.000Z',
    }
    reply = { status: 200, body: ticket }

    const result = await connectPod('t 1')

    expect(result).toEqual({ outcome: EPodConnectOutcome.Ready, ticket })
    expect(calls).toEqual([{ url: '/v1/threads/t%201/pod/connect', method: 'POST' }])
  })

  it('answers not-running instead of throwing on a 409 pod-not-running', async () => {
    reply = { status: 409, body: { code: 'pod-not-running', message: 'not running' } }

    expect(await connectPod('t1')).toEqual({ outcome: EPodConnectOutcome.NotRunning })
  })

  it('still throws on a 409 with another code', async () => {
    reply = { status: 409, body: { code: 'something-else', message: 'nope' } }

    await expect(connectPod('t1')).rejects.toBeInstanceOf(CloudApiError)
  })

  it('throws on a server error', async () => {
    reply = { status: 500, body: { message: 'boom' } }

    await expect(connectPod('t1')).rejects.toBeInstanceOf(CloudApiError)
  })
})
