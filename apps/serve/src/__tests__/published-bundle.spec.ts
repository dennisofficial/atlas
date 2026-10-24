import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { buildContextArchive } from '@dltech/atlas-harness'
import type { PublishedBundleCurrent } from '@dltech/atlas-wire'

import { applyPublishedBundle } from '../published-bundle'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { trpcFailure, trpcOk } from './trpc-fake'
import { ATLAS_HOME, fakeFiles } from './workspace-files-fixture'

const API = 'https://api.example.com'
const BLOB_URL = 'https://blob.example.com/bundles/u/b.tar.gz'
const PROJECT = '/srv/project'

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0, scratch.length)) rmSync(dir, { recursive: true, force: true })
})

const asFetch = (call: (request: Request) => Response | Promise<Response>): typeof fetch =>
  Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      call(input instanceof Request ? new Request(input, init) : new Request(String(input), init)),
    { preconnect: () => undefined },
  )

const tarballOf = async (entries: Record<string, string>): Promise<Buffer> => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-bundle-spec-'))
  scratch.push(root)
  const files = Object.entries(entries).map(([key, text]) => {
    const path = join(root, 'src', key)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return { key, path }
  })
  const archive = await buildContextArchive({ files })
  if (archive === undefined) throw new Error('no archive built')
  return archive
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const currentOf = (args: { bytes: Buffer; sha256?: string }): PublishedBundleCurrent => ({
  version: 3,
  sha256: args.sha256 ?? sha256Of(args.bytes),
  sizeBytes: args.bytes.byteLength,
  manifest: { skills: ['.agents/x'], instructions: ['ATLAS.md'], mcp: true },
  createdAt: '2026-10-20T00:00:00.000Z',
  downloadUrl: BLOB_URL,
})

const run = async (args: { fetchFn: typeof fetch; sleep?: (ms: number) => Promise<void> }) => {
  const { files, written } = fakeFiles()
  const lines: ServeLogLine[] = []
  await applyPublishedBundle({
    atlasHome: ATLAS_HOME,
    projectDirectory: PROJECT,
    controlPlaneUrl: API,
    token: 'pod-token',
    clientVersion: '1.2.3',
    fetchFn: args.fetchFn,
    log: (line) => lines.push(line),
    files,
    sleep: args.sleep ?? (async () => undefined),
  })
  return { written, lines }
}

const fullBundle = () =>
  tarballOf({
    'user-layer/skills/.agents/x/SKILL.md': 'skill body',
    'user-layer/instructions/.atlas/ATLAS.md': 'global instructions',
    '.atlas/mcp.json': '{"servers":{}}',
    'user-layer/memory/user/a.md': 'memory must not land',
  })

describe('applyPublishedBundle', () => {
  it('writes skills, instructions and mcp config and drops memory', async () => {
    const bytes = await fullBundle()
    const requests: Request[] = []
    const fetchFn = asFetch((request) => {
      requests.push(request)
      return request.url === BLOB_URL ? new Response(bytes) : trpcOk(currentOf({ bytes }))
    })

    const { written, lines } = await run({ fetchFn })

    expect(Object.fromEntries(written)).toEqual({
      [join(ATLAS_HOME, '.agents/skills/x/SKILL.md')]: 'skill body',
      [join(ATLAS_HOME, 'ATLAS.md')]: 'global instructions',
      [join(ATLAS_HOME, 'mcp.json')]: '{"servers":{}}',
    })
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleReady])
    expect(lines[0]).toMatchObject({ version: 3, written: 3 })

    const api = requests.find((request) => request.url !== BLOB_URL)
    expect(new URL(api?.url ?? '').pathname).toBe('/v1/trpc/publishedBundles.current')
    expect(api?.headers.get('authorization')).toBe('Bearer pod-token')
    expect(api?.headers.get('atlas-client-version')).toBe('1.2.3')
    const blob = requests.find((request) => request.url === BLOB_URL)
    expect(blob?.headers.get('authorization')).toBeNull()
  })

  it('logs absent and writes nothing on a 404', async () => {
    const { written, lines } = await run({
      fetchFn: asFetch(() => trpcFailure({ status: 404 })),
    })

    expect(written.size).toBe(0)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleAbsent])
  })

  it('fails and writes nothing when the sha256 does not match', async () => {
    const bytes = await fullBundle()
    const fetchFn = asFetch((request) =>
      request.url === BLOB_URL
        ? new Response(bytes)
        : trpcOk(currentOf({ bytes, sha256: 'a'.repeat(64) })),
    )

    const { written, lines } = await run({ fetchFn })

    expect(written.size).toBe(0)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleFailed])
    expect(JSON.stringify(lines)).not.toContain('pod-token')
  })

  it('fails when the blob download is not 2xx', async () => {
    const bytes = await fullBundle()
    const fetchFn = asFetch((request) =>
      request.url === BLOB_URL ? new Response(null, { status: 403 }) : trpcOk(currentOf({ bytes })),
    )

    const { written, lines } = await run({ fetchFn })

    expect(written.size).toBe(0)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleFailed])
  })

  it('fails on a malformed current answer', async () => {
    const { written, lines } = await run({ fetchFn: asFetch(() => trpcOk({ version: 1 })) })

    expect(written.size).toBe(0)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleFailed])
  })

  it('retries a 401 with one second sleeps until the lease registers', async () => {
    const bytes = await fullBundle()
    let apiCalls = 0
    const sleeps: number[] = []
    const fetchFn = asFetch((request) => {
      if (request.url === BLOB_URL) return new Response(bytes)
      apiCalls += 1
      return apiCalls === 1
        ? trpcFailure({ status: 401, message: 'unauthorized' })
        : trpcOk(currentOf({ bytes }))
    })

    const { written, lines } = await run({
      fetchFn,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    expect(apiCalls).toBe(2)
    expect(sleeps).toEqual([1_000])
    expect(written.size).toBe(3)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleReady])
  })

  it('does not retry an unavailable API, so a down API costs boot one request', async () => {
    let apiCalls = 0
    const fetchFn = asFetch(() => {
      apiCalls += 1
      return trpcFailure({ status: 503 })
    })

    const { written, lines } = await run({ fetchFn })

    expect(apiCalls).toBe(1)
    expect(written.size).toBe(0)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleFailed])
  })

  it('gives the blob download a deadline', async () => {
    const bytes = await fullBundle()
    let blobSignal: AbortSignal | null | undefined
    const fetchFn = asFetch((request) => {
      if (request.url !== BLOB_URL) return trpcOk(currentOf({ bytes }))
      blobSignal = request.signal
      return new Response(bytes)
    })

    await run({ fetchFn })

    expect(blobSignal?.aborted).toBe(false)
    expect(blobSignal).toBeInstanceOf(AbortSignal)
  })

  it('gives up after ten 401s and logs failure', async () => {
    let apiCalls = 0
    const fetchFn = asFetch(() => {
      apiCalls += 1
      return trpcFailure({ status: 401, message: 'unauthorized' })
    })

    const { written, lines } = await run({ fetchFn })

    expect(apiCalls).toBe(10)
    expect(written.size).toBe(0)
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.BundleFailed])
  })
})
