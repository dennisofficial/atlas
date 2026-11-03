import { afterEach, describe, expect, it, mock } from 'bun:test'
import { createExpoPushClient, receiptDeadToken, ticketDeadToken } from './expo-push.client'

const realFetch = globalThis.fetch
let calls: { url: string; init?: RequestInit | undefined }[] = []
let handler: (url: string) => { status: number; body: unknown }

const fakeFetch = () => {
  calls = []
  globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const { status, body } = handler(url)
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('expo push client', () => {
  it('sends messages with the access token and parses tickets', async () => {
    fakeFetch()
    handler = () => ({
      status: 200,
      body: {
        data: [
          { status: 'ok', id: 't1' },
          { status: 'error', details: { error: 'MessageTooBig' } },
        ],
      },
    })
    const client = createExpoPushClient({ accessToken: 'tok' })
    const tickets = await client.send([{ to: 'ExponentPushToken[a]', title: 'T', body: 'B' }])
    expect(calls[0]?.url).toBe('https://exp.host/--/api/v2/push/send')
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer tok' })
    expect(tickets).toHaveLength(2)
    expect(tickets[1] && ticketDeadToken(tickets[1])).toBe(false)
  })

  it('omits the authorization header without an access token', async () => {
    fakeFetch()
    handler = () => ({ status: 200, body: { data: [] } })
    const client = createExpoPushClient({})
    await client.send([{ to: 'ExponentPushToken[a]', title: 'T', body: 'B' }])
    expect(calls[0]?.init?.headers).not.toHaveProperty('authorization')
  })

  it('batches sends at 100 per request', async () => {
    fakeFetch()
    handler = () => ({ status: 200, body: { data: [{ status: 'ok', id: 't' }] } })
    const client = createExpoPushClient({})
    const messages = Array.from({ length: 101 }, (_, i) => ({
      to: `ExponentPushToken[${i}]`,
      title: 'T',
      body: 'B',
    }))
    await client.send(messages)
    expect(calls).toHaveLength(2)
    expect(JSON.parse(String(calls[0]?.init?.body))).toHaveLength(100)
    expect(JSON.parse(String(calls[1]?.init?.body))).toHaveLength(1)
  })

  it('fetches receipts and spots dead tokens', async () => {
    fakeFetch()
    handler = () => ({
      status: 200,
      body: {
        data: {
          t1: { status: 'ok' },
          t2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        },
      },
    })
    const client = createExpoPushClient({})
    const receipts = await client.getReceipts(['t1', 't2'])
    expect(calls[0]?.url).toBe('https://exp.host/--/api/v2/push/getReceipts')
    expect(receiptDeadToken(receipts.t2!)).toBe(true)
    expect(receiptDeadToken(receipts.t1!)).toBe(false)
  })

  it('throws on a 5xx so the caller can retry', async () => {
    fakeFetch()
    handler = () => ({ status: 500, body: {} })
    const client = createExpoPushClient({})
    await expect(
      client.send([{ to: 'ExponentPushToken[a]', title: 'T', body: 'B' }]),
    ).rejects.toThrow('500')
  })
})
