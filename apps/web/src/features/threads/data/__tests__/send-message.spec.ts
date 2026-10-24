import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EThreadMessageState } from '@dltech/atlas-wire/web'

import { fakeFetch, mutationUrl, trpcOk, type SeenCall } from './trpc-fake'

import { deliverMessage, sendMessage } from '../send-message'

let calls: SeenCall[]
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = fakeFetch(() => trpcOk({ state: EThreadMessageState.Queued }))
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('sendMessage', () => {
  it('mutates only threadMessages.send with the given sendId and returns the state', async () => {
    const state = await sendMessage({ threadId: 't 1', text: 'hi', sendId: 's1' })
    expect(state).toBe(EThreadMessageState.Queued)
    expect(calls).toEqual([
      {
        url: mutationUrl('threadMessages.send'),
        method: 'POST',
        body: { threadId: 't 1', sendId: 's1', text: 'hi' },
      },
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
    expect(calls).toEqual([
      {
        url: mutationUrl('threadMessages.send'),
        method: 'POST',
        body: { threadId: 't1', sendId: 's1', text: 'hi' },
      },
    ])
  })
})
