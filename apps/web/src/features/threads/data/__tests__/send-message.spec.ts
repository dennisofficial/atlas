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
  it('mutates only threadMessages.send with the given sendId and returns the reply', async () => {
    const reply = await sendMessage({ threadId: 't 1', text: 'hi', sendId: 's1' })
    expect(reply).toEqual({ state: EThreadMessageState.Queued })
    expect(calls).toEqual([
      {
        url: mutationUrl('threadMessages.send'),
        method: 'POST',
        body: { threadId: 't 1', sendId: 's1', text: 'hi' },
      },
    ])
  })
})

const attachments = [
  {
    id: 'a',
    name: 'a.png',
    mediaType: 'image/png',
    size: 3,
    content: { store: 'inline' as const, data: 'QUJD' },
  },
]

describe('sendMessage attachments', () => {
  it('posts attachments when given and omits an empty list', async () => {
    await sendMessage({
      threadId: 't1',
      text: 'hi',
      sendId: 's1',
      attachments,
    })
    await sendMessage({
      threadId: 't1',
      text: 'hi',
      sendId: 's2',
      attachments: [],
    })
    expect(calls.map((call) => call.body)).toEqual([
      { threadId: 't1', sendId: 's1', text: 'hi', attachments },
      { threadId: 't1', sendId: 's2', text: 'hi' },
    ])
  })
})

describe('deliverMessage', () => {
  it('passes attachments to the live send and skips HTTP', async () => {
    const sent: unknown[] = []
    await deliverMessage({
      threadId: 't1',
      text: 'hi',
      sendId: 's1',
      attachments,
      liveSend: (message) => {
        sent.push(message)
        return true
      },
    })
    expect(sent).toEqual([{ text: 'hi', requestId: 's1', attachments }])
    expect(calls).toEqual([])
  })

  it('posts attachments over HTTP when the socket cannot take the send', async () => {
    await deliverMessage({
      threadId: 't1',
      text: 'hi',
      sendId: 's1',
      attachments,
      liveSend: () => false,
    })
    expect(calls.map((call) => call.body)).toEqual([
      { threadId: 't1', sendId: 's1', text: 'hi', attachments },
    ])
  })

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

describe('deliverMessage dispatch failure', () => {
  it('rejects with the API error when the fallback reply carries one', async () => {
    calls = fakeFetch(() =>
      trpcOk({ state: EThreadMessageState.Queued, error: "Couldn't start the sandbox. Retry." }),
    )
    const delivery = deliverMessage({
      threadId: 't1',
      text: 'hi',
      sendId: 's1',
      liveSend: () => false,
    })
    await expect(delivery).rejects.toThrow("Couldn't start the sandbox. Retry.")
  })

  it('resolves when the live socket takes the send, without touching HTTP', async () => {
    await expect(
      deliverMessage({ threadId: 't1', text: 'hi', sendId: 's1', liveSend: () => true }),
    ).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })

  it('resolves when the fallback reply has no error', async () => {
    await expect(
      deliverMessage({ threadId: 't1', text: 'hi', sendId: 's1', liveSend: () => false }),
    ).resolves.toBeUndefined()
  })
})
