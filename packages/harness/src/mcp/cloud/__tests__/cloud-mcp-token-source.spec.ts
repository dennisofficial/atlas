import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '@dltech/atlas-core'
import {
  EMcpOauthAccessOutcome,
  EMcpServerSource,
  type McpOauthAccessInput,
} from '@dltech/atlas-wire/web'

import type { McpTokenTarget } from '../../bridge/token-source'
import { CloudMcpTokenSource } from '../cloud-mcp-token-source'

const URL_A = 'https://mcp.example.com/mcp'

const projectServer = (name: string, url = URL_A): McpTokenTarget => ({
  name,
  url,
  origin: EDefinitionOrigin.Project,
})

const rig = (answers: unknown[]) => {
  const calls: McpOauthAccessInput[] = []
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

    expect(await source.currentToken({ server: projectServer('a') })).toBe('t1')
    expect(await source.currentToken({ server: projectServer('a') })).toBe('t1')
    expect(calls).toHaveLength(1)

    advance(4 * 60_000 + 30_000)
    expect(await source.currentToken({ server: projectServer('a') })).toBe('t2')
    expect(calls).toHaveLength(2)
  })

  it('treats needs-auth, malformed bodies and network errors as no token', async () => {
    const { source } = rig([
      { outcome: EMcpOauthAccessOutcome.NeedsAuth },
      { nonsense: true },
      new Error('offline'),
    ])

    for (const name of ['a', 'b', 'c']) {
      expect(await source.currentToken({ server: projectServer(name) })).toBeUndefined()
    }
  })

  it('evicts a rejected token and reports it on the next fetch', async () => {
    const { source, calls } = rig([granted('old'), granted('new')])

    await source.currentToken({ server: projectServer('a') })
    source.reject({ server: projectServer('a'), token: 'old' })
    const next = await source.currentToken({ server: projectServer('a') })

    expect(next).toBe('new')
    expect(calls[1]).toEqual({
      name: 'a',
      source: EMcpServerSource.Repo,
      url: URL_A,
      rejectedAccessToken: 'old',
    })
  })

  it('caps the lifetime of a token that carries no expiry at five minutes', async () => {
    const { source, calls, advance } = rig([granted('a'), granted('b')])

    await source.currentToken({ server: projectServer('a') })
    advance(3 * 60_000)
    expect(await source.currentToken({ server: projectServer('a') })).toBe('a')
    advance(2 * 60_000)
    expect(await source.currentToken({ server: projectServer('a') })).toBe('b')
    expect(calls).toHaveLength(2)
  })

  it('remembers a failure per server for a minute and forgets it on clearFailures', async () => {
    const { source, calls, advance } = rig([
      { outcome: EMcpOauthAccessOutcome.NeedsAuth },
      granted('t'),
    ])

    expect(await source.currentToken({ server: projectServer('a') })).toBeUndefined()
    expect(await source.currentToken({ server: projectServer('a') })).toBeUndefined()
    expect(calls).toHaveLength(1)

    source.clearFailures()
    expect(await source.currentToken({ server: projectServer('a') })).toBe('t')
    expect(calls).toHaveLength(2)

    const second = rig([new Error('down'), granted('u')])
    await second.source.currentToken({ server: projectServer('a') })
    second.advance(61_000)
    expect(await second.source.currentToken({ server: projectServer('a') })).toBe('u')
    void advance
  })

  it('keeps same-url servers with different names in separate cache entries and calls', async () => {
    const { source, calls } = rig([granted('first'), granted('second')])

    expect(await source.currentToken({ server: projectServer('one') })).toBe('first')
    expect(await source.currentToken({ server: projectServer('two') })).toBe('second')
    expect(await source.currentToken({ server: projectServer('one') })).toBe('first')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ name: 'one', source: EMcpServerSource.Repo, url: URL_A })
    expect(calls[1]).toEqual({ name: 'two', source: EMcpServerSource.Repo, url: URL_A })
  })

  it('maps project origin to the repo source and user origin to the cloud source', async () => {
    const { source, calls } = rig([granted('p'), granted('u')])

    await source.currentToken({ server: projectServer('proj') })
    await source.currentToken({
      server: { name: 'usr', url: 'https://user.example.com/mcp', origin: EDefinitionOrigin.User },
    })

    expect(calls).toEqual([
      { name: 'proj', source: EMcpServerSource.Repo, url: URL_A },
      { name: 'usr', source: EMcpServerSource.Cloud, url: 'https://user.example.com/mcp' },
    ])
  })

  it('never calls the API for a built-in server', async () => {
    const { source, calls } = rig([granted('t')])

    expect(
      await source.currentToken({
        server: { name: 'b', url: URL_A, origin: EDefinitionOrigin.BuiltIn },
      }),
    ).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('refetches when the url of a cached server changes', async () => {
    const { source, calls } = rig([granted('old-url'), granted('new-url')])

    expect(await source.currentToken({ server: projectServer('a') })).toBe('old-url')
    expect(
      await source.currentToken({ server: projectServer('a', 'https://moved.example.com/mcp') }),
    ).toBe('new-url')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({
      name: 'a',
      source: EMcpServerSource.Repo,
      url: 'https://moved.example.com/mcp',
    })
  })
})
