import { describe, expect, it } from 'bun:test'
import { controlPlaneError, createApiClient, detailsOf, httpStatusOf } from '../client'

type FetchInput = Parameters<typeof fetch>[0]
type Seen = { url: string; headers: Headers; credentials: string | undefined }

const recordingFetch = (seen: Seen[]): typeof fetch =>
  Object.assign(
    async (input: FetchInput, init?: RequestInit) => {
      seen.push({
        url: String(input),
        headers: new Headers(init?.headers),
        credentials: init?.credentials,
      })
      return Response.json({ result: { data: { head: 1 } } })
    },
    { preconnect: fetch.preconnect },
  )

const failingFetch = (): typeof fetch =>
  Object.assign(
    async () =>
      Response.json(
        {
          error: {
            message: 'conflict',
            code: -32603,
            data: { code: 'CONFLICT', httpStatus: 409, details: { seq: 3 } },
          },
        },
        { status: 409 },
      ),
    { preconnect: fetch.preconnect },
  )

describe('createApiClient', () => {
  it('sends the bearer token and client version to <baseUrl>/v1/trpc', async () => {
    const seen: Seen[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test/',
      token: 'tok',
      clientVersion: '1.2.3',
      fetchFn: recordingFetch(seen),
    })

    await client.sandboxSelf.events.mutate({ events: [] }).catch(() => undefined)

    expect(seen[0]?.url).toBe('https://api.atlas.test/v1/trpc/sandboxSelf.events')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer tok')
    expect(seen[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('sends no authorization header without a token, and keeps same-origin credentials', async () => {
    const seen: Seen[] = []
    const client = createApiClient({ baseUrl: '', fetchFn: recordingFetch(seen) })

    await client.sandboxSelf.events.mutate({ events: [] }).catch(() => undefined)

    expect(seen[0]?.url).toBe('/v1/trpc/sandboxSelf.events')
    expect(seen[0]?.headers.has('authorization')).toBe(false)
    expect(seen[0]?.headers.has('atlas-client-version')).toBe(false)
    expect(seen[0]?.credentials).toBe('same-origin')
  })

  it('exposes the status, details and a control-plane error for a failed call', async () => {
    const client = createApiClient({ baseUrl: 'https://api.atlas.test', fetchFn: failingFetch() })

    const failure = await client.sandboxSelf.events.mutate({ events: [] }).catch((error) => error)

    expect(httpStatusOf(failure)).toBe(409)
    expect(detailsOf(failure)).toEqual({ seq: 3 })
    expect(controlPlaneError(failure).message).toBe('the control plane answered 409: conflict')
  })

  it('passes a non-tRPC failure through unchanged', () => {
    const failure = new Error('offline')

    expect(httpStatusOf(failure)).toBeUndefined()
    expect(controlPlaneError(failure)).toBe(failure)
  })
})
