import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { resolveMcpSpecs } from '../config/loaders'
import { RemoteMcpSource } from '../config/remote-mcp-source'
import {
  CompatMcpSource,
  EMcpRejection,
  FileMcpSource,
  type McpTextReader,
} from '../config/sources'

const stdio = { kind: 'stdio', command: 'npx' } as const

const httpLinear = { kind: 'http', url: 'https://example.test' } as const

const text = (json: unknown): McpTextReader => () => Promise.resolve(JSON.stringify(json))

const userSource = (json: unknown) => FileMcpSource.user({ read: text(json) })
const projectSource = (json: unknown) =>
  FileMcpSource.project({ cwd: '/repo', read: text(json) })
const compatSource = (json: unknown) =>
  new CompatMcpSource({ cwd: '/repo', read: text(json) })

const remoteSource = (servers: readonly Record<string, unknown>[]) =>
  new RemoteMcpSource({
    session: { url: 'http://cloud.test', token: 'sess_test', email: null },
    fetchFn: (async (_input: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ servers }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch,
  })

describe('resolveMcpSpecs', () => {
  it('yields one spec per name, with the project file shadowing the user file', async () => {
    const resolved = await resolveMcpSpecs({
      sources: [
        userSource({ linear: { transport: httpLinear } }),
        projectSource({ linear: { transport: stdio } }),
      ],
    })

    expect(resolved.specs).toHaveLength(1)
    expect(resolved.specs[0]?.transport).toEqual(stdio)
    expect(resolved.specs[0]?.origin).toBe(EDefinitionOrigin.Project)
    expect(resolved.shadowed.map((spec) => spec.origin)).toEqual([EDefinitionOrigin.User])
  })

  it('lets a disabled project entry switch a user server off without repeating a transport', async () => {
    const resolved = await resolveMcpSpecs({
      sources: [
        userSource({ linear: { transport: stdio } }),
        projectSource({ linear: { disabled: true } }),
      ],
    })

    expect(resolved.specs).toHaveLength(1)
    expect(resolved.specs[0]).toMatchObject({ name: 'linear', disabled: true })
    expect(resolved.specs[0]?.transport).toBeUndefined()
  })

  it('keeps servers from every layer when no name collides', async () => {
    const resolved = await resolveMcpSpecs({
      sources: [
        userSource({ personal: { transport: stdio } }),
        projectSource({ shared: { transport: stdio } }),
      ],
    })

    expect(resolved.specs.map((spec) => spec.name)).toEqual(['personal', 'shared'])
  })

  it('lets the native project file win a same-rank tie against the compat file', async () => {
    const resolved = await resolveMcpSpecs({
      sources: [
        projectSource({ linear: { transport: stdio } }),
        compatSource({ linear: { transport: httpLinear }, extra: { transport: stdio } }),
      ],
    })

    expect(resolved.specs.map((spec) => spec.name)).toEqual(['extra', 'linear'])
    const linear = resolved.specs.find((spec) => spec.name === 'linear')
    expect(linear?.transport).toEqual(stdio)
    expect(linear?.definedIn).toContain('.atlas')
    expect(resolved.shadowed).toEqual([])
  })

  it('lets the remote server win a same-rank tie against the local user file', async () => {
    const resolved = await resolveMcpSpecs({
      sources: [
        remoteSource([{ name: 'linear', transport: httpLinear, updatedAt: '2026-01-01T00:00:00.000Z' }]),
        userSource({ linear: { transport: stdio } }),
      ],
    })

    expect(resolved.specs).toHaveLength(1)
    expect(resolved.specs[0]?.transport).toEqual(httpLinear)
    expect(resolved.specs[0]?.origin).toBe(EDefinitionOrigin.User)
    expect(resolved.shadowed.map((spec) => spec.transport)).toEqual([stdio])
  })

  it('holds the compat pin whatever order the sources arrive in', async () => {
    const resolved = await resolveMcpSpecs({
      sources: [
        compatSource({ linear: { transport: httpLinear } }),
        projectSource({ linear: { transport: stdio } }),
      ],
    })

    expect(resolved.specs).toHaveLength(1)
    expect(resolved.specs[0]?.transport).toEqual(stdio)
  })

  it('still reads compat servers the native file does not name', async () => {
    const resolved = await resolveMcpSpecs({
      sources: [compatSource({ legacy: { transport: stdio } })],
    })

    expect(resolved.specs.map((spec) => spec.name)).toEqual(['legacy'])
    expect(resolved.specs[0]?.origin).toBe(EDefinitionOrigin.Project)
  })

  it('reports rejected and unreadable rows alongside the surviving specs', async () => {
    const denied: McpTextReader = () => {
      const error = new Error('EACCES: permission denied') as Error & { code: string }
      error.code = 'EACCES'
      return Promise.reject(error)
    }

    const resolved = await resolveMcpSpecs({
      sources: [
        userSource({ 'bad name': { transport: stdio }, good: { transport: stdio } }),
        FileMcpSource.project({ cwd: '/repo', read: denied }),
      ],
    })

    expect(resolved.specs.map((spec) => spec.name)).toEqual(['good'])
    expect(resolved.rejections.map((entry) => [entry.rejection, entry.name])).toEqual([
      [EMcpRejection.BadName, 'bad name'],
      [EMcpRejection.Unreadable, undefined],
    ])
  })

  it('resolves an empty layered set to nothing', async () => {
    const resolved = await resolveMcpSpecs({ sources: [] })

    expect(resolved).toEqual({ specs: [], shadowed: [], rejections: [] })
  })
})
