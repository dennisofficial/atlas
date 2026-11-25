import { describe, expect, it } from 'bun:test'
import { createApiClient } from '../client'

type FetchInput = Parameters<typeof fetch>[0]

const stickingFetch = (seen: (RequestInit | undefined)[]): typeof fetch =>
  Object.assign(
    (_input: FetchInput, init?: RequestInit): Promise<Response> => {
      seen.push(init)
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal === undefined || signal === null) return
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    },
    { preconnect: fetch.preconnect },
  )

const answeringFetch = (seen: (RequestInit | undefined)[]): typeof fetch =>
  Object.assign(
    async (_input: FetchInput, init?: RequestInit) => {
      seen.push(init)
      return Response.json({ result: { data: { ok: true } } })
    },
    { preconnect: fetch.preconnect },
  )

describe('createApiClient query deadline', () => {
  it('settles a query on a stuck socket through the deadline signal', async () => {
    const seen: (RequestInit | undefined)[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      fetchFn: stickingFetch(seen),
      queryDeadlineMs: 20,
    })
    const started = Date.now()

    const failure = await client.secrets.details.query().catch((error) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(seen[0]?.method).toBe('GET')
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(seen[0]?.signal?.aborted).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('leaves a mutation unbounded, so a slow write is never aborted', async () => {
    const seen: (RequestInit | undefined)[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      fetchFn: answeringFetch(seen),
      queryDeadlineMs: 20,
    })

    await client.sessionDrafts.put.mutate({ sessionId: null, text: 'hello', attachments: [] })
    await Bun.sleep(60)

    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.signal?.aborted ?? false).toBe(false)
  })
})
