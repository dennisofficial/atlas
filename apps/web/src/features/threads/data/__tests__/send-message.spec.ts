import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EThreadMessageState } from '@dltech/atlas-wire/web'

import { deliverMessage, sendMessage } from '../send-message'

let calls: { url: string; body: unknown }[]
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    return new Response(JSON.stringify({ state: EThreadMessageState.Queued }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('sendMessage', () => {
  it('posts only to /messages with the given sendId and returns the state', async () => {
    const state = await sendMessage({ threadId: 't 1', text: 'hi', sendId: 's1' })
    expect(state).toBe(EThreadMessageState.Queued)
    expect(calls).toEqual([
      { url: '/v1/threads/t%201/messages', body: { sendId: 's1', text: 'hi' } },
    ])
  })
})

describe('deliverMessage', () => {
  it('sends over the live socket with the sendId as requestId and skips HTTP', async () => {
    const sent: { text: string; requestId: string }[] = []
    await deliverMessage({
      threadId: 't1',
      text: 'hi',
      sendId: 's1',
      liveSend: (message) => {
        sent.push(message)
        return true
      },
    })
    expect(sent).toEqual([{ text: 'hi', requestId: 's1' }])
    expect(calls).toEqual([])
  })

  it('posts over HTTP when the socket cannot take the send', async () => {
    await deliverMessage({ threadId: 't1', text: 'hi', sendId: 's1', liveSend: () => false })
    expect(calls).toEqual([{ url: '/v1/threads/t1/messages', body: { sendId: 's1', text: 'hi' } }])
  })
})
