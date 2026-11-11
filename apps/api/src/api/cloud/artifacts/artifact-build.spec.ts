import { createHash } from 'node:crypto'
import { contentTypeOf, parseSpec, type ManifestEntry } from '@dltech/atlas-artifacts'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ARTIFACT_LOG_CAP_BYTES, ArtifactBuild } from './artifact-build'
import { blobPathOf } from '@dltech/atlas-artifacts'
import { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ARTIFACT_BUILD_CLAMP_MS, ARTIFACT_WORKSPACE } from './artifact-sandbox'
import {
  FakeArtifactSandbox,
  builtFiles,
  finishedCommand,
  sandboxResult,
} from './artifact-sandbox.fakes'

const sha256Of = (body: string): string => createHash('sha256').update(body).digest('hex')

const SOURCE = [
  { path: 'index.html', body: '<h1>hello</h1>' },
  { path: 'app.css', body: 'h1{color:red}' },
]

const BUILD = { cmd: 'bun run build', outDir: 'dist' }

describe('ArtifactBuild', () => {
  const blobs = new FakeArtifactBlobStore()
  const sandbox = new FakeArtifactSandbox()
  const build = new ArtifactBuild(sandbox, blobs)

  const seedSource = (): ManifestEntry[] =>
    SOURCE.map((file) => {
      blobs.seed({ pathname: blobPathOf(sha256Of(file.body)), body: file.body })
      return {
        path: file.path,
        tree: 'src' as const,
        sha256: sha256Of(file.body),
        size: Buffer.byteLength(file.body),
        type: contentTypeOf(file.path),
      }
    })

  const run = (args: { spec: unknown; result: Parameters<FakeArtifactSandbox['scripted']>[0] }) => {
    sandbox.scripted(args.result)
    return build.run({ threadId: 'thread-a', spec: parseSpec(args.spec), source: seedSource() })
  }

  beforeEach(() => {
    blobs.reset()
    sandbox.reset()
  })

  it('installs, builds and makes the outDir tree the dist manifest', async () => {
    const outDir = builtFiles([
      { path: 'index.html', body: '<h1>built</h1>' },
      { path: 'assets/app.js', body: 'console.log(1)' },
    ])

    const result = await run({
      spec: { build: { ...BUILD, install: 'bun install' } },
      result: sandboxResult({ install: finishedCommand({ stdout: 'prepared' }), outDir }),
    })

    if (result.status !== 'ready') throw new Error(result.failure)
    expect(result.manifest).toEqual([
      {
        path: 'assets/app.js',
        tree: 'dist',
        sha256: sha256Of('console.log(1)'),
        size: 14,
        type: 'application/javascript; charset=utf-8',
      },
      {
        path: 'index.html',
        tree: 'dist',
        sha256: sha256Of('<h1>built</h1>'),
        size: 14,
        type: 'text/html; charset=utf-8',
      },
    ])
    expect(blobs.stored.has(blobPathOf(sha256Of('<h1>built</h1>')))).toBe(true)
    expect(result.log).toContain('prepared')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('writes the source tree into the workspace and runs install then build', async () => {
    await run({
      spec: { build: { ...BUILD, install: 'bun install' } },
      result: sandboxResult({
        outDir: builtFiles([{ path: 'index.html', body: 'built' }]),
      }),
    })

    expect(ARTIFACT_WORKSPACE).toBe('/workspace')
    expect(sandbox.lastRequest.files.map((file) => file.path)).toEqual(['index.html', 'app.css'])
    expect(sandbox.lastRequest.files[0]?.content.toString()).toBe('<h1>hello</h1>')
    expect(sandbox.lastRequest.install).toBe('bun install')
    expect(sandbox.lastRequest.cmd).toBe('bun run build')
    expect(sandbox.lastRequest.outDir).toBe('dist')
  })

  it('passes only the image environment, never a credential', async () => {
    await run({
      spec: { build: BUILD },
      result: sandboxResult({ outDir: builtFiles([{ path: 'index.html', body: 'built' }]) }),
    })

    const env = sandbox.lastRequest.env
    expect(Object.keys(env).sort()).toEqual(['CI', 'HOME', 'NODE_ENV', 'PATH'])
    expect(env).toEqual({
      CI: '1',
      NODE_ENV: 'production',
      HOME: ARTIFACT_WORKSPACE,
      PATH: expect.any(String),
    })
    for (const [key, value] of Object.entries(env)) {
      expect(key).not.toMatch(/token|key|secret|bearer|password/i)
      expect(value).not.toMatch(/token|bearer|secret/i)
    }
  })

  it('clamps a long spec budget to 180s and says so on the first log line', async () => {
    const result = await run({
      spec: { build: { ...BUILD, timeoutSec: 900 } },
      result: sandboxResult({ outDir: builtFiles([{ path: 'index.html', body: 'built' }]) }),
    })

    expect(sandbox.lastRequest.timeoutMs).toBe(ARTIFACT_BUILD_CLAMP_MS)
    expect(ARTIFACT_BUILD_CLAMP_MS).toBe(180_000)
    expect(result.log.split('\n')[0]).toContain('clamped to 180s')
  })

  it('fails on an install that exits non-zero, naming its last stderr line', async () => {
    const result = await run({
      spec: { build: { ...BUILD, install: 'bun install' } },
      result: sandboxResult({
        install: finishedCommand({
          exitCode: 1,
          stderr: 'resolving\nnpm ERR! 404 no such package',
        }),
        build: null,
      }),
    })

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.failure).toBe('install failed with exit code 1: npm ERR! 404 no such package')
    expect(result.log).toContain('==> install (exit 1)')
  })

  it('fails on a build that exits non-zero, falling back to the exit code', async () => {
    const result = await run({
      spec: { build: BUILD },
      result: sandboxResult({ build: finishedCommand({ exitCode: 2 }) }),
    })

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.failure).toBe('build failed with exit code 2')
  })

  it('fails a run that hits the clamp and keeps its log', async () => {
    const result = await run({
      spec: { build: { ...BUILD, timeoutSec: 600 } },
      result: sandboxResult({
        build: finishedCommand({ exitCode: 137, stdout: 'compiling', timedOut: true }),
      }),
    })

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.failure).toBe('build timed out after 180s')
    expect(result.log).toContain('compiling')
  })

  it('fails when the outDir is missing or empty, naming the directory', async () => {
    const result = await run({ spec: { build: BUILD }, result: sandboxResult({ outDir: [] }) })

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.failure).toBe('build.outDir dist is missing or empty after the build')
  })

  it('fails a tree over the version caps without uploading anything', async () => {
    const files = builtFiles(
      Array.from({ length: 2001 }, (_, index) => ({ path: `page-${index}.html`, body: 'x' })),
    )

    const result = await run({ spec: { build: BUILD }, result: sandboxResult({ outDir: files }) })

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.failure).toBe('files 2001 exceeds 2000')
    expect(blobs.stored.size).toBe(SOURCE.length)
  })

  it('caps the log, keeping the tail and the exit code', async () => {
    const stdout = `build-started\n${'x'.repeat(200_000)}\nbuild-finished`

    const result = await run({
      spec: { build: BUILD },
      result: sandboxResult({ build: finishedCommand({ exitCode: 3, stdout }) }),
    })

    expect(Buffer.byteLength(result.log)).toBeLessThanOrEqual(ARTIFACT_LOG_CAP_BYTES)
    expect(result.log).toContain('build-finished')
    expect(result.log).not.toContain('build-started')
    expect(result.log).toMatch(/\[log truncated: kept the last \d+ of \d+ bytes; exit code 3\]$/)
  })

  it('reuses a dist blob the pool already holds', async () => {
    blobs.seed({ pathname: blobPathOf(sha256Of('built')), body: 'built' })
    blobs.requestedUploads.length = 0

    const result = await run({
      spec: { build: BUILD },
      result: sandboxResult({ outDir: builtFiles([{ path: 'index.html', body: 'built' }]) }),
    })

    expect(result.status).toBe('ready')
    expect(blobs.requestedUploads).toEqual([])
  })
})
