import { describe, expect, it } from 'bun:test'

import { EMcpOauthAccessOutcome } from '@dltech/atlas-wire/web'

import { CloudMcpTokenSource } from '../cloud-mcp-token-source'

const URL_A = 'https://mcp.example.com/mcp'

const rig = (answers: unknown[]) => {
  const calls: { serverUrl: string; rejectedAccessToken?: string | undefined }[] = []
  let now = 1_000_000
  const source = new CloudMcpTokenSource({
    access: async (args) => {
      calls.push(args)
      const next = answers.shift()
      if (next instanceof Error) throw next
      return next
    },
    nowMs: () => now,
  })
  return { source, calls, advance: (ms: number) => void (now += ms) }
}

const granted = (accessToken: string, expiresAt?: string) => ({
  outcome: EMcpOauthAccessOutcome.Granted,
  accessToken,
  ...(expiresAt === undefined ? {} : { expiresAt }),
})

describe('CloudMcpTokenSource', () => {
  it('caches a token until a minute before it expires', async () => {
    const { source, calls, advance } = rig([
      granted('t1', new Date(1_000_000 + 5 * 60_000).toISOString()),
      granted('t2'),
    ])

    expect(await source.currentToken({ serverUrl: URL_A })).toBe('t1')
    expect(await source.currentToken({ serverUrl: URL_A })).toBe('t1')
    expect(calls).toHaveLength(1)

    advance(4 * 60_000 + 30_000)
    expect(await source.currentToken({ serverUrl: URL_A })).toBe('t2')
    expect(calls).toHaveLength(2)
  })

  it('treats needs-auth, malformed bodies and network errors as no token', async () => {
    const { source } = rig([
      { outcome: EMcpOauthAccessOutcome.NeedsAuth },
      { nonsense: true },
      new Error('offline'),
    ])

    for (const url of ['https://a.test/mcp', 'https://b.test/mcp', 'https://c.test/mcp']) {
      expect(await source.currentToken({ serverUrl: url })).toBeUndefined()
    }
  })

  it('evicts a rejected token and reports it on the next fetch', async () => {
    const { source, calls } = rig([granted('old'), granted('new')])

    await source.currentToken({ serverUrl: URL_A })
    source.reject({ serverUrl: URL_A, token: 'old' })
    const next = await source.currentToken({ serverUrl: URL_A })

    expect(next).toBe('new')
    expect(calls[1]).toEqual({ serverUrl: URL_A, rejectedAccessToken: 'old' })
  })

  it('caps the lifetime of a token that carries no expiry at five minutes', async () => {
    const { source, calls, advance } = rig([granted('a'), granted('b')])

    await source.currentToken({ serverUrl: URL_A })
    advance(3 * 60_000)
    expect(await source.currentToken({ serverUrl: URL_A })).toBe('a')
    advance(2 * 60_000)
    expect(await source.currentToken({ serverUrl: URL_A })).toBe('b')
    expect(calls).toHaveLength(2)
  })

  it('remembers a failure per url for a minute and forgets it on clearFailures', async () => {
    const { source, calls, advance } = rig([
      { outcome: EMcpOauthAccessOutcome.NeedsAuth },
      granted('t'),
    ])

    expect(await source.currentToken({ serverUrl: URL_A })).toBeUndefined()
    expect(await source.currentToken({ serverUrl: URL_A })).toBeUndefined()
    expect(calls).toHaveLength(1)

    source.clearFailures()
    expect(await source.currentToken({ serverUrl: URL_A })).toBe('t')
    expect(calls).toHaveLength(2)

    const second = rig([new Error('down'), granted('u')])
    await second.source.currentToken({ serverUrl: URL_A })
    second.advance(61_000)
    expect(await second.source.currentToken({ serverUrl: URL_A })).toBe('u')
    void advance
  })
})
