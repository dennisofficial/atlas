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
  body?: unknown
  expect: (input: unknown, init?: RequestInit) => void
}): typeof fetch =>
  (async (input: unknown, init?: RequestInit) => {
    args.expect(input, init)
    return new Response(args.body === undefined ? '' : JSON.stringify(args.body), {
      status: args.status,
    })
  }) as typeof fetch

describe('SandboxClient.readCheckpoint', () => {
  it('GETs the checkpoint route with user auth and parses the reply', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test/',
      token: 'sess_user',
      fetchFn: fakeFetch({
        status: 200,
        body: { checkpoint },
        expect: (input, init) => {
          expect(String(input)).toBe('https://cloud.test/v1/sandboxes/thread-1/checkpoint')
          expect(init?.method).toBe('GET')
          const headers = (init?.headers ?? {}) as Record<string, string>
          expect(headers.authorization).toBe('Bearer sess_user')
        },
      }),
    })

    await expect(client.readCheckpoint({ threadId: 'thread-1' })).resolves.toEqual(checkpoint)
  })

  it('tolerates a 404 as unknown', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test',
      token: 'sess_user',
      fetchFn: fakeFetch({ status: 404, body: { message: 'sandbox not found' }, expect: () => undefined }),
    })

    await expect(client.readCheckpoint({ threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('reads a null checkpoint body as unknown', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test',
      token: 'sess_user',
      fetchFn: fakeFetch({ status: 200, body: { checkpoint: null }, expect: () => undefined }),
    })

    await expect(client.readCheckpoint({ threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('reads a malformed reply as unknown rather than throwing', async () => {
    const client = new SandboxClient({
      url: 'https://cloud.test',
      token: 'sess_user',
      fetchFn: fakeFetch({
        status: 200,
        body: { checkpoint: { ...checkpoint, phase: 'melting' } },
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
        return new Response(
          JSON.stringify([
            {
              threadId: 'thread-1',
              name: 'sandbox',
              driveName: null,
              state: 'stopped',
              lastActivityAt: '2026-10-01T00:00:00.000Z',
            },
            {
              threadId: 'thread-2',
              name: 'sandbox',
              driveName: null,
              state: 'unknown',
              lastActivityAt: '2026-10-01T00:00:00.000Z',
            },
          ]),
          { status: 200 },
        )
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
