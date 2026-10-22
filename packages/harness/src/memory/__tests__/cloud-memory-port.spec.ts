import { describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire'

import type { CloudSession } from '../../cloud/cloud-session'
import { CloudMemoryPort } from '../cloud-memory-port'
import { MemoryEditRefused, MemoryUnavailable } from '../memory-port'

const SESSION: CloudSession = { url: 'https://cloud.test', token: 'tok-1', email: null }

type Call = { url: string; method: string; authorization: string | null; body: unknown }

const SUMMARY = {
  scope: 'global',
  project: null,
  name: 'a',
  description: 'd',
  type: 'user',
  revision: 3,
  updatedAt: '2026-10-20T00:00:00.000Z',
}

const portWith = (args: {
  respond: (call: Call) => Response
  project?: string | null
  session?: CloudSession | null
}) => {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    return args.respond(call)
  }) as typeof fetch
  const port = new CloudMemoryPort({
    project: args.project === undefined ? 'org/repo' : args.project,
    session: () => (args.session === undefined ? SESSION : args.session),
    clientVersion: '1.0.0',
    fetchFn,
  })
  return { port, calls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('CloudMemoryPort', () => {
  it('lists with the bearer token and the project query', async () => {
    const { port, calls } = portWith({ respond: () => json({ memories: [SUMMARY] }) })

    expect(await port.list()).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://cloud.test/v1/memories?project=org%2Frepo')
    expect(calls[0]?.authorization).toBe('Bearer tok-1')
  })

  it('lists without a project query when there is no project', async () => {
    const { port, calls } = portWith({ respond: () => json({ memories: [] }), project: null })

    await port.list()

    expect(calls[0]?.url).toBe('https://cloud.test/v1/memories')
  })

  it('retries a list by default and makes a single bounded attempt under a deadline', async () => {
    const attempts = { unbounded: 0, bounded: 0 }
    const unbounded = portWith({
      respond: () => {
        attempts.unbounded += 1
        return attempts.unbounded === 1 ? json({}, 503) : json({ memories: [] })
      },
    })
    const bounded = portWith({
      respond: () => {
        attempts.bounded += 1
        return json({}, 503)
      },
    })

    await unbounded.port.list()
    await bounded.port.list({ timeoutMs: 100 }).catch(() => undefined)

    expect(attempts).toEqual({ unbounded: 2, bounded: 1 })
  })

  it('reads a 404 as null', async () => {
    const { port } = portWith({ respond: () => json({ message: 'no' }, 404) })

    expect(await port.read({ scope: EMemoryScope.Global, name: 'a' })).toBeNull()
  })

  it('sends the project on a project-scope read', async () => {
    const { port, calls } = portWith({ respond: () => json({ ...SUMMARY, body: 'b' }) })

    const entry = await port.read({ scope: EMemoryScope.Project, name: 'a' })

    expect(entry?.body).toBe('b')
    expect(calls[0]?.url).toBe(
      'https://cloud.test/v1/memories/entry?scope=project&name=a&project=org%2Frepo',
    )
  })

  it('writes with PUT and returns the new revision', async () => {
    const { port, calls } = portWith({ respond: () => json(SUMMARY) })

    const saved = await port.write({
      scope: EMemoryScope.Global,
      name: 'a',
      description: 'd',
      type: EMemoryType.User,
      body: 'b',
    })

    expect(saved.revision).toBe(3)
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.body).toEqual({
      scope: 'global',
      name: 'a',
      description: 'd',
      type: 'user',
      body: 'b',
    })
  })

  it('maps a 409 on edit to MemoryEditRefused carrying the code', async () => {
    const { port } = portWith({
      respond: () => json({ message: 'stale, current 4', code: 'memory-stale-revision' }, 409),
    })

    const failure = await port
      .edit({ scope: EMemoryScope.Global, name: 'a', old: 'x', new: 'y', revision: 3 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryEditRefused)
    expect((failure as MemoryEditRefused).code).toBe('memory-stale-revision')
  })

  it('maps a 422 on edit to MemoryEditRefused', async () => {
    const { port } = portWith({
      respond: () => json({ message: 'ambiguous', code: 'memory-edit-ambiguous' }, 422),
    })

    const failure = await port
      .edit({ scope: EMemoryScope.Global, name: 'a', old: 'x', new: 'y', revision: 3 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryEditRefused)
  })

  it('deletes with true, and false on 404', async () => {
    const gone = portWith({ respond: () => new Response(null, { status: 204 }) })
    const missing = portWith({ respond: () => json({}, 404) })

    expect(await gone.port.delete({ scope: EMemoryScope.Global, name: 'a' })).toBe(true)
    expect(await missing.port.delete({ scope: EMemoryScope.Global, name: 'a' })).toBe(false)
  })

  it('refuses a project-scope call without a project, before any request', async () => {
    const { port, calls } = portWith({ respond: () => json({}), project: null })

    const failure = await port
      .read({ scope: EMemoryScope.Project, name: 'a' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryUnavailable)
    expect((failure as Error).message).toContain('only global memory is available')
    expect(calls).toHaveLength(0)
  })

  it('refuses when signed out', async () => {
    const { port, calls } = portWith({ respond: () => json({}), session: null })

    const failure = await port.list().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryUnavailable)
    expect((failure as Error).message).toBe('sign in to Atlas Cloud to use memory')
    expect(calls).toHaveLength(0)
  })

  it('rejects a body that is not a memory list', async () => {
    const { port } = portWith({ respond: () => json({ nope: true }) })

    expect(port.list()).rejects.toThrow('not a memory')
  })
})
