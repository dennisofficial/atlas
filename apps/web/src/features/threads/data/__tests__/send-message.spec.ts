import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ESandboxProvisionState, EThreadMessageState } from '@dltech/atlas-wire/web'

import { ESendKind, sendMessage } from '../send-message'

let calls: { url: string; body: unknown }[]
let provisionReply: unknown
const realFetch = globalThis.fetch

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
    return url.endsWith('/sandbox') ? json(provisionReply) : json({ state: EThreadMessageState.Queued })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('sendMessage', () => {
  it('stops at not-configured without posting the message', async () => {
    provisionReply = { state: ESandboxProvisionState.NotConfigured, error: 'Add a Vercel token' }
    const outcome = await sendMessage({ threadId: 't 1', projectId: 'p1', text: 'hi', sendId: 's1' })
    expect(outcome).toEqual({ kind: ESendKind.NotConfigured, error: 'Add a Vercel token' })
    expect(calls.map((call) => call.url)).toEqual(['/v1/threads/t%201/sandbox'])
    expect(calls[0]?.body).toEqual({ projectId: 'p1' })
  })

  it('provisions then posts the message with the given sendId', async () => {
    provisionReply = { state: ESandboxProvisionState.Booting }
    const outcome = await sendMessage({ threadId: 't1', text: 'hi', sendId: 's1' })
    expect(outcome).toEqual({ kind: ESendKind.Sent, state: EThreadMessageState.Queued })
    expect(calls.map((call) => call.url)).toEqual(['/v1/threads/t1/sandbox', '/v1/threads/t1/messages'])
    expect(calls[0]?.body).toEqual({})
    expect(calls[1]?.body).toEqual({ sendId: 's1', text: 'hi' })
  })
})
