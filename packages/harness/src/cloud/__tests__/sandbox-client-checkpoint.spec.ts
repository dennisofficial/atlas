import { describe, expect, it } from 'bun:test'

import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { ECloudSandboxState, SandboxClient } from '../sandbox-client'

const fakeFetchOf = (
  handler: (input: unknown, init?: RequestInit) => Promise<Response>,
): typeof fetch =>
  Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      handler(input, init),
    { preconnect: () => undefined },
  )

const checkpoint: RuntimeCheckpoint = {
  threadId: 'thread-1',
  runtimeId: 'runtime-1',
  sandboxSessionId: 'sandbox-session-1',
  revision: 3,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-01T12:00:00.000Z',
  transcript: { head: 9, count: 9, digest: 'a'.repeat(64) },
}

const fakeFetch = (args: {
  status: number
  data?: unknown
  message?: string
  expect: (input: unknown, init?: RequestInit) => void
}): typeof fetch =>
  (async (input: unknown, init?: RequestInit) => {
    args.expect(input, init)
    if (args.status >= 400) {
      return Response.json(
        {
          error: {
            message: args.message ?? 'failed',
            code: -32603,
            data: { code: 'ERROR', httpStatus: args.status },
          },
        },
        { status: args.status },
      )
    }
    return Response.json({ result: { data: args.data ?? null } })
  }) as typeof fetch

describe('SandboxClient.readCheckpoint', () => {
  it('GETs the checkpoint route with user auth and parses the reply', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test/',
      token: 'sess_user',
      fetchFn: fakeFetch({
        status: 200,
        data: { checkpoint },
        expect: (input, init) => {
          const url = new URL(String(input))
          expect(`${url.origin}${url.pathname}`).toBe(
            'https://cloud.test/v1/trpc/sandboxCheckpoint.get',
          )
          expect(JSON.parse(url.searchParams.get('input') ?? 'null')).toEqual({
            threadId: 'thread-1',
          })
          expect(init?.method ?? 'GET').toBe('GET')
          expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sess_user')
        },
      }),
    })

    await expect(client.readCheckpoint({ threadId: 'thread-1' })).resolves.toEqual(checkpoint)
  })

  it('tolerates a 404 as unknown', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test',
      token: 'sess_user',
      fetchFn: fakeFetch({
        status: 404,
        message: 'sandbox not found',
        expect: () => undefined,
      }),
    })

    await expect(client.readCheckpoint({ threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('reads a null checkpoint body as unknown', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test',
      token: 'sess_user',
      fetchFn: fakeFetch({ status: 200, data: { checkpoint: null }, expect: () => undefined }),
    })

    await expect(client.readCheckpoint({ threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('reads a malformed reply as unknown rather than throwing', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test',
      token: 'sess_user',
      fetchFn: fakeFetch({
        status: 200,
        data: { checkpoint: { ...checkpoint, phase: 'melting' } },
        expect: () => undefined,
      }),
    })

    await expect(client.readCheckpoint({ threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('parses stopped and unknown sandbox states', async () => {
    const seen: string[] = []
    const client = new SandboxClient({
      url: 'https://cloud.test',
      token: 'sess_user',
      fetchFn: fakeFetchOf(async () => {
        seen.push('listed')
        return Response.json({
          result: {
            data: [
              {
                threadId: 'thread-1',
                name: 'sandbox',
                state: 'stopped',
                lastActivityAt: '2026-10-01T00:00:00.000Z',
              },
              {
                threadId: 'thread-2',
                name: 'sandbox',
                state: 'unknown',
                lastActivityAt: '2026-10-01T00:00:00.000Z',
              },
            ],
          },
        })
      }),
    })

    const sandboxes = await client.listSandboxes()
    expect(seen).toHaveLength(1)
    expect(sandboxes.map((sandbox) => sandbox.state)).toEqual([
      ECloudSandboxState.Stopped,
      ECloudSandboxState.Unknown,
    ])
  })
})
