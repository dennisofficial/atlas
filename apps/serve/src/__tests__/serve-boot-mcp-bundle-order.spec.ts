import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { buildContextArchive } from '@dltech/atlas-harness'

import { EWorkspaceState } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'

import { trpcFailure, trpcOk, trpcProcedureOf } from './trpc-fake'

const BLOB_URL = 'https://blob.example.com/bundles/u/b.tar.gz'

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-boot-mcp-order-'))
  scratch.push(dir)
  return dir
}

const bundleWithMcp = async (mcp: unknown): Promise<Buffer> => {
  const root = tempDir()
  const path = join(root, '.atlas/mcp.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(mcp))
  const archive = await buildContextArchive({ files: [{ key: '.atlas/mcp.json', path }] })
  if (archive === undefined) throw new Error('no archive built')
  return archive
}

describe('serve boot MCP config', () => {
  it('keeps account MCP servers after the published bundle writes its mcp.json', async () => {
    const atlasHome = tempDir()
    const bytes = await bundleWithMcp({
      published: { transport: { kind: 'http', url: 'https://published.example.com/mcp' } },
    })
    const cloudFetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === BLOB_URL) return new Response(bytes)
      const procedure = trpcProcedureOf(url.split('?')[0] ?? '')
      if (procedure === 'accountLease.get') return trpcOk({ accounts: [], active: [] })
      if (procedure === 'sandboxConfig.get') {
        return trpcOk({
          settings: {},
          secrets: [],
          harnessSecrets: [],
          mcpServers: [
            {
              name: 'account',
              spec: { transport: { kind: 'http', url: 'https://account.example.com/mcp' } },
            },
          ],
          provenance: {},
          fileMounts: [],
        })
      }
      if (procedure === 'publishedBundles.current') {
        return trpcOk({
          version: 1,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sizeBytes: bytes.byteLength,
          manifest: { skills: [], instructions: [], mcp: true },
          createdAt: '2026-11-03T00:00:00.000Z',
          downloadUrl: BLOB_URL,
        })
      }
      return trpcFailure({ status: 404 })
    }) as unknown as typeof fetch

    await bootServeFiles({
      env: { HOME: tempDir() },
      threadId: toThreadId('thread-mcp-order'),
      cwd: atlasHome,
      atlasHome,
      log: () => undefined,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      controlPlaneUrl: 'https://api.example.com',
      token: 't',
      clientVersion: 'dev',
      fetchFn: cloudFetch,
      notice: { notify: () => undefined },
      containerSetup: async () => {
        throw new Error('setup must not run')
      },
    })

    const written = JSON.parse(readFileSync(join(atlasHome, 'mcp.json'), 'utf8'))
    expect(Object.keys(written.mcpServers).sort()).toEqual(['account', 'published'])
    expect(written.mcpServers.account.transport.url).toBe('https://account.example.com/mcp')
  })
})
