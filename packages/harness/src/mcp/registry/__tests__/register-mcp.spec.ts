import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import { CloudSessionStore } from '../../../cloud/cloud-session'
import { createIsolatedContainer } from '../../../container/injection'
import {
  CloudSessionStoreToken,
  SecretsStoreToken,
  ServeSessionToken,
} from '../../../container/tokens'
import { MemorySecretsStore } from '../../../secrets/memory-store'
import { FileMcpSource } from '../../config/sources'
import { EMcpServerStatus } from '../handle-status'
import { mcpSourcesFor, registerMcp } from '../register-mcp'
import { startGatedMcpServer } from './gated-server'

const session = { url: 'http://cloud.test', token: 'sess_test', email: 'a@b.c' }

let directory: string
let realAtlasHome: string | undefined

let fetched: string[]
const realFetch = globalThis.fetch

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-register-mcp-'))
  realAtlasHome = process.env['ATLAS_HOME']
  process.env['ATLAS_HOME'] = directory
  fetched = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetched.push(String(input))
    return new Response(JSON.stringify({ servers: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (realAtlasHome === undefined) delete process.env['ATLAS_HOME']
  else process.env['ATLAS_HOME'] = realAtlasHome
  rmSync(directory, { recursive: true, force: true })
})

describe('mcpSourcesFor', () => {
  it('lists only the local layers, builtin first and compat last', () => {
    const sources = mcpSourcesFor({ cwd: directory })

    expect(sources.map((source) => source.origin)).toEqual([
      EDefinitionOrigin.BuiltIn,
      EDefinitionOrigin.User,
      EDefinitionOrigin.Project,
      EDefinitionOrigin.Project,
    ])
    expect(sources.every((source) => source.load.length === 0)).toBe(true)
  })

  it('reads the signed-in user layer from the local file, never the cloud', async () => {
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({
        linear: { transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' } },
      }),
    )

    const sources = mcpSourcesFor({ cwd: directory })
    const reads = await Promise.all(sources.map((source) => source.load()))

    const specs = reads.flatMap((read) => read.specs)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({
      name: 'linear',
      origin: EDefinitionOrigin.User,
      definedIn: join(directory, 'mcp.json'),
    })
    expect(fetched).toHaveLength(0)
  })

  it('lets the local user file stand alone when a project layer shadows nothing', async () => {
    const sources = mcpSourcesFor({ cwd: directory })
    const userLayer = sources.find((source) => source.origin === EDefinitionOrigin.User)

    expect(userLayer).toBeInstanceOf(FileMcpSource)
  })
})

describe('registerMcp', () => {
  it('never touches the cloud even when the container holds a signed-in session', async () => {
    const container = createIsolatedContainer()
    const sessions = new CloudSessionStore({
      file: join(directory, 'cloud.json'),
      keyFile: join(directory, 'key'),
    })
    sessions.write(session)
    container.register(CloudSessionStoreToken, { useValue: sessions })

    const registered = await registerMcp({ container, cwd: directory })

    expect(registered.store.servers()).toHaveLength(0)
    expect(registered.rejections).toEqual([])
    expect(fetched).toHaveLength(0)
  })

  it('exposes signIn when a real MemorySecretsStore is registered under the token', async () => {
    const container = createIsolatedContainer()
    container.register(SecretsStoreToken, { useValue: new MemorySecretsStore() })

    const registered = await registerMcp({ container, cwd: directory })

    expect(registered.signIn).toBeDefined()
  })

  it('leaves signIn absent when the container holds no secrets store token', async () => {
    const container = createIsolatedContainer()

    const registered = await registerMcp({ container, cwd: directory })

    expect(registered.signIn).toBeUndefined()
  })

  it('returns before servers connect and settles `connected` once they have', async () => {
    const gated = startGatedMcpServer({ status: 200 })
    globalThis.fetch = realFetch
    try {
      writeFileSync(
        join(directory, 'mcp.json'),
        JSON.stringify({ slow: { transport: { kind: 'http', url: gated.url } } }),
      )
      const container = createIsolatedContainer()

      const registered = await registerMcp({ container, cwd: directory })
      expect(registered.store.servers()).toHaveLength(0)

      gated.release()
      await registered.connected

      expect(registered.store.servers()).toHaveLength(1)
    } finally {
      gated.stop()
    }
  })
})

describe('registerMcp token source choice', () => {
  const writeHttpServer = (url: string) =>
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({ srv: { transport: { kind: 'http', url } } }),
    )

  it('uses the cloud token source and no local sign-in when ServeSessionToken is registered', async () => {
    const calls: string[] = []
    const gated = startGatedMcpServer({ status: 401 })
    gated.release()
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url.startsWith(session.url)) {
        return Response.json({
          result: { data: { outcome: 'needs-auth' } },
        })
      }
      return realFetch(input, init)
    }) as typeof fetch
    try {
      writeHttpServer(gated.url)
      const container = createIsolatedContainer()
      container.register(ServeSessionToken, { useValue: session })
      container.register(SecretsStoreToken, { useValue: new MemorySecretsStore() })

      const registered = await registerMcp({ container, cwd: directory })
      await registered.connected

      expect(registered.signIn).toBeUndefined()
      expect(registered.store.statusOf({ serverId: 'srv' })?.state.status).toBe(
        EMcpServerStatus.NeedsAuth,
      )
      expect(calls.some((url) => url.startsWith(session.url))).toBe(true)
    } finally {
      gated.stop()
    }
  })

  it('keeps the local loopback flow when only a secrets store is registered', async () => {
    writeHttpServer('http://127.0.0.1:1/mcp')
    const container = createIsolatedContainer()
    container.register(SecretsStoreToken, { useValue: new MemorySecretsStore() })

    const registered = await registerMcp({ container, cwd: directory })

    expect(registered.signIn).toBeDefined()
  })

  it('refresh picks up servers added to the config after boot', async () => {
    const container = createIsolatedContainer()
    const registered = await registerMcp({ container, cwd: directory })
    await registered.connected
    expect(registered.store.servers()).toHaveLength(0)

    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({
        late: { transport: { kind: 'stdio', command: 'definitely-not-a-binary' } },
      }),
    )
    await registered.refresh()

    expect(registered.store.servers().map((s) => s.spec.name)).toEqual(['late'])
  })

  it('returns within the budget while a slow refresh keeps running, and overlapping refreshes share it', async () => {
    const gated = startGatedMcpServer({ status: 200 })
    globalThis.fetch = realFetch
    try {
      const container = createIsolatedContainer()
      const registered = await registerMcp({ container, cwd: directory, refreshBudgetMs: 30 })
      await registered.connected
      writeFileSync(
        join(directory, 'mcp.json'),
        JSON.stringify({ slow: { transport: { kind: 'http', url: gated.url } } }),
      )

      const started = Date.now()
      const first = registered.refresh()
      const second = registered.refresh()
      await Promise.all([first, second])
      expect(Date.now() - started).toBeLessThan(1_000)
      expect(registered.store.servers()).toHaveLength(0)

      gated.release()
      await registered.refresh()
      await registered.refresh()
      expect(registered.store.servers().map((s) => s.spec.name)).toEqual(['slow'])
      expect(registered.store.servers()[0]?.state.status).toBe(EMcpServerStatus.Connected)
    } finally {
      gated.stop()
    }
  })
})
