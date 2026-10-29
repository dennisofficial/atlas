import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { buildContextArchive } from '@dltech/atlas-harness'

import { EWorkspaceState } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'

import { trpcOk, trpcProcedureOf } from './trpc-fake'

const API = 'https://api.example.com'
const BLOB_URL = 'https://blob.example.com/bundles/u/b.tar.gz'
const INSTRUCTIONS_PATH = '.atlas/ATLAS.md'
const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const scratchDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-cloud-instructions-'))
  scratch.push(dir)
  return dir
}

const bundleWithInstructions = async (text: string): Promise<Buffer> => {
  const root = scratchDir()
  const path = join(root, 'ATLAS.md')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  const archive = await buildContextArchive({
    files: [{ key: 'user-layer/instructions/.atlas/ATLAS.md', path }],
  })
  if (archive === undefined) throw new Error('no archive built')
  return archive
}

type StoredRow = { content: string | null; tombstonedAt: string | null } | undefined

const fileRowOf = (stored: StoredRow) =>
  stored === undefined
    ? []
    : [
        {
          path: INSTRUCTIONS_PATH,
          revision: 2,
          contentHash: '',
          tombstonedAt: stored.tombstonedAt,
          content: stored.content,
        },
      ]

const cloudFetch = (args: { bundle: Buffer; stored: StoredRow }): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === BLOB_URL) return new Response(args.bundle)
    const procedure = trpcProcedureOf(url.split('?')[0] ?? url)
    if (procedure === 'publishedBundles.current') {
      return trpcOk({
        version: 1,
        sha256: createHash('sha256').update(args.bundle).digest('hex'),
        sizeBytes: args.bundle.byteLength,
        manifest: { skills: [], instructions: ['ATLAS.md'], mcp: false },
        createdAt: '2026-10-20T00:00:00.000Z',
        downloadUrl: BLOB_URL,
      })
    }
    if (procedure === 'userFiles.get') return trpcOk({ files: fileRowOf(args.stored) })
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch

const bootWith = async (args: { bundled: string; stored: StoredRow }): Promise<string> => {
  const atlasHome = scratchDir()
  await bootServeFiles({
    env: {},
    threadId: toThreadId('thread-cloud-instructions'),
    cwd: atlasHome,
    atlasHome,
    log: () => undefined,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    controlPlaneUrl: API,
    token: 'pod-token',
    clientVersion: 'dev',
    fetchFn: cloudFetch({
      bundle: await bundleWithInstructions(args.bundled),
      stored: args.stored,
    }),
  })
  const file = join(atlasHome, 'ATLAS.md')
  return existsSync(file) ? readFileSync(file, 'utf8') : '<absent>'
}

const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

describe('global instructions saved in Atlas Cloud', () => {
  it('replace the pushed bundle copy when the account copy was blanked', async () => {
    const text = await bootWith({
      bundled: 'old pushed rules',
      stored: { content: base64(''), tombstonedAt: null },
    })

    expect(text).toBe('')
  })

  it('replace the pushed bundle copy with the account text', async () => {
    const text = await bootWith({
      bundled: 'old pushed rules',
      stored: { content: base64('saved on the web'), tombstonedAt: null },
    })

    expect(text).toBe('saved on the web')
  })

  it('empty the file when the account copy was deleted', async () => {
    const text = await bootWith({
      bundled: 'old pushed rules',
      stored: { content: null, tombstonedAt: '2026-10-28T00:00:00.000Z' },
    })

    expect(text).toBe('')
  })

  it('leave the bundle copy alone when the account never stored instructions', async () => {
    const text = await bootWith({ bundled: 'old pushed rules', stored: undefined })

    expect(text).toBe('old pushed rules')
  })
})
