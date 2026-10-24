import { describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire'

import type { CloudSession } from '../../cloud/cloud-session'
import { trpcCallOf, trpcData, trpcFailure, trpcVoid } from '../../cloud/__tests__/trpc-wire'
import { CloudMemoryPort } from '../cloud-memory-port'
import { MemoryEditRefused, MemoryUnavailable } from '../memory-port'

const SESSION: CloudSession = { url: 'https://cloud.test', token: 'tok-1', email: null }

type Call = {
  url: string
  method: string
  procedure: string
  authorization: string | null
  input: unknown
}

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
    const traced = trpcCallOf({ input, init })
    const call: Call = {
      url: String(input),
      method: traced.method,
      procedure: traced.procedure,
      authorization: headers.get('authorization'),
      input: traced.input,
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

const refusal = (args: {
  status: number
  trpcCode: string
  code: string
  message: string
}): Response =>
  trpcFailure({
    status: args.status,
    message: args.message,
    trpcCode: args.trpcCode,
    details: { message: args.message, code: args.code },
  })

const editArgs = {
  scope: EMemoryScope.Global,
  name: 'a',
  old: 'x',
  new: 'y',
  revision: 3,
} as const

describe('CloudMemoryPort', () => {
  it('lists with the bearer token and the project input', async () => {
    const { port, calls } = portWith({ respond: () => trpcData({ memories: [SUMMARY] }) })

    expect(await port.list()).toHaveLength(1)
    expect(calls[0]?.procedure).toBe('memories.list')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.input).toEqual({ project: 'org/repo' })
    expect(calls[0]?.authorization).toBe('Bearer tok-1')
  })

  it('lists with an empty input when there is no project', async () => {
    const { port, calls } = portWith({
      respond: () => trpcData({ memories: [] }),
      project: null,
    })

    await port.list()

    expect(calls[0]?.url).toStartWith('https://cloud.test/v1/trpc/memories.list')
    expect(calls[0]?.input).toEqual({})
  })

  it('retries a list by default and makes a single bounded attempt under a deadline', async () => {
    const attempts = { unbounded: 0, bounded: 0 }
    const unbounded = portWith({
      respond: () => {
        attempts.unbounded += 1
        return attempts.unbounded === 1 ? trpcFailure({ status: 503 }) : trpcData({ memories: [] })
      },
    })
    const bounded = portWith({
      respond: () => {
        attempts.bounded += 1
        return trpcFailure({ status: 503 })
      },
    })

    await unbounded.port.list()
    await bounded.port.list({ timeoutMs: 100 }).catch(() => undefined)

    expect(attempts).toEqual({ unbounded: 2, bounded: 1 })
  })

  it('reads a 404 as null', async () => {
    const { port } = portWith({
      respond: () => refusal({ status: 404, trpcCode: 'NOT_FOUND', code: 'x', message: 'no' }),
    })

    expect(await port.read({ scope: EMemoryScope.Global, name: 'a' })).toBeNull()
  })

  it('sends the project on a project-scope read', async () => {
    const { port, calls } = portWith({ respond: () => trpcData({ ...SUMMARY, body: 'b' }) })

    const entry = await port.read({ scope: EMemoryScope.Project, name: 'a' })

    expect(entry?.body).toBe('b')
    expect(calls[0]?.procedure).toBe('memories.get')
    expect(calls[0]?.input).toEqual({ scope: 'project', name: 'a', project: 'org/repo' })
  })

  it('writes with a mutation and returns the new revision', async () => {
    const { port, calls } = portWith({ respond: () => trpcData(SUMMARY) })

    const saved = await port.write({
      scope: EMemoryScope.Global,
      name: 'a',
      description: 'd',
      type: EMemoryType.User,
      body: 'b',
    })

    expect(saved.revision).toBe(3)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.procedure).toBe('memories.put')
    expect(calls[0]?.input).toEqual({
      scope: 'global',
      name: 'a',
      description: 'd',
      type: 'user',
      body: 'b',
    })
  })

  it.each([
    { status: 409, trpcCode: 'CONFLICT', code: 'memory-stale-revision' },
    { status: 422, trpcCode: 'UNPROCESSABLE_CONTENT', code: 'memory-edit-no-match' },
    { status: 422, trpcCode: 'UNPROCESSABLE_CONTENT', code: 'memory-edit-ambiguous' },
  ])('maps a $status $trpcCode on edit to MemoryEditRefused carrying $code', async (refused) => {
    const { port, calls } = portWith({
      respond: () => refusal({ ...refused, message: `refused: ${refused.code}` }),
    })

    const failure = await port.edit(editArgs).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryEditRefused)
    expect((failure as MemoryEditRefused).code).toBe(refused.code)
    expect((failure as MemoryEditRefused).message).toContain(`refused: ${refused.code}`)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.procedure).toBe('memories.edit')
    expect(calls[0]?.input).toEqual({
      scope: 'global',
      name: 'a',
      old: 'x',
      new: 'y',
      revision: 3,
    })
  })

  it('lets a non-refusal edit failure through as it is', async () => {
    const { port } = portWith({ respond: () => trpcFailure({ status: 500, message: 'boom' }) })

    const failure = await port.edit(editArgs).catch((error: unknown) => error)

    expect(failure).not.toBeInstanceOf(MemoryEditRefused)
    expect((failure as Error).message).toContain('boom')
  })

  it('deletes with true, and false on a 404', async () => {
    const gone = portWith({ respond: () => trpcVoid() })
    const missing = portWith({
      respond: () => refusal({ status: 404, trpcCode: 'NOT_FOUND', code: 'x', message: 'no' }),
    })

    expect(await gone.port.delete({ scope: EMemoryScope.Global, name: 'a' })).toBe(true)
    expect(gone.calls[0]?.procedure).toBe('memories.remove')
    expect(gone.calls[0]?.method).toBe('POST')
    expect(await missing.port.delete({ scope: EMemoryScope.Global, name: 'a' })).toBe(false)
  })

  it('does not swallow a non-404 delete failure', async () => {
    const { port } = portWith({ respond: () => trpcFailure({ status: 500 }) })

    expect(port.delete({ scope: EMemoryScope.Global, name: 'a' })).rejects.toThrow()
  })

  it('refuses a project-scope call without a project, before any request', async () => {
    const { port, calls } = portWith({ respond: () => trpcVoid(), project: null })

    const failure = await port
      .read({ scope: EMemoryScope.Project, name: 'a' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryUnavailable)
    expect((failure as Error).message).toContain('only global memory is available')
    expect(calls).toHaveLength(0)
  })

  it('refuses when signed out', async () => {
    const { port, calls } = portWith({ respond: () => trpcVoid(), session: null })

    const failure = await port.list().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryUnavailable)
    expect((failure as Error).message).toBe('sign in to Atlas Cloud to use memory')
    expect(calls).toHaveLength(0)
  })

  it('rejects a body that is not a memory list, naming the procedure', async () => {
    const { port } = portWith({ respond: () => trpcData({ nope: true }) })

    expect(port.list()).rejects.toThrow('memories.list with a body that is not a memory')
  })
})
