import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import { CloudSessionStore } from '../../../cloud/cloud-session'
import { createIsolatedContainer } from '../../../container/injection'
import { CloudSessionStoreToken } from '../../../container/tokens'
import { FileMcpSource } from '../../config/sources'
import { RemoteMcpSource } from '../../config/remote-mcp-source'
import { mcpSourcesFor, registerMcp } from '../register-mcp'

const session = { url: 'http://cloud.test', token: 'sess_test', email: 'a@b.c' }

let directory: string
const realFetch = globalThis.fetch
const realAtlasHome = process.env['ATLAS_HOME']

let fetched: string[]

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-register-mcp-'))
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
  it('replaces the user file source with the remote source when a session exists', () => {
    const sources = mcpSourcesFor({ session, cwd: directory })

    expect(sources[1]).toBeInstanceOf(RemoteMcpSource)
    expect(sources[1]?.origin).toBe(EDefinitionOrigin.User)
    expect(sources[2]).toBeInstanceOf(FileMcpSource)
  })

  it('keeps the user file source when no session exists', () => {
    const sources = mcpSourcesFor({ session: null, cwd: directory })

    expect(sources[1]).toBeInstanceOf(FileMcpSource)
    expect(sources[1]).not.toBeInstanceOf(RemoteMcpSource)
  })
})

describe('registerMcp', () => {
  it('loads the user layer from the cloud when the container holds a session', async () => {
    const container = createIsolatedContainer()
    const sessions = new CloudSessionStore({
      file: join(directory, 'cloud.json'),
      keyFile: join(directory, 'key'),
    })
    sessions.write(session)
    container.register(CloudSessionStoreToken, { useValue: sessions })

    const store = await registerMcp({ container, cwd: directory })

    expect(store.servers()).toHaveLength(0)
    expect(fetched).toEqual(['http://cloud.test/v1/mcp-servers'])
  })

  it('never touches the cloud when the container holds no session store', async () => {
    const container = createIsolatedContainer()

    const store = await registerMcp({ container, cwd: directory })

    expect(store.servers()).toHaveLength(0)
    expect(fetched).toHaveLength(0)
  })
})
