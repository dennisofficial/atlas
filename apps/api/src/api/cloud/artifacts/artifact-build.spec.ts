import { parseSpec } from '@dltech/atlas-artifacts'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ARTIFACT_BUILD_CLAMP_MS, ARTIFACT_WORKSPACE } from './artifact-sandbox'
import { ARTIFACT_LOG_CAP_BYTES, ArtifactBuild, capArtifactLog } from './artifact-build'
import {
  FakeArtifactSandbox,
  builtFiles,
  finishedCommand,
  sandboxResult,
} from './artifact-sandbox.fakes'

const SOURCE = builtFiles([
  { path: 'index.html', body: '<h1>hello</h1>' },
  { path: 'app.css', body: 'h1{color:red}' },
])

const BUILD = { cmd: 'bun run build', outDir: 'dist' }

describe('ArtifactBuild', () => {
  const sandbox = new FakeArtifactSandbox()
  const build = new ArtifactBuild(sandbox)

  const run = (args: { spec: unknown; result: Parameters<FakeArtifactSandbox['scripted']>[0] }) => {
    sandbox.scripted(args.result)
    return build.run({ owner: { threadId: 'thread-a' }, spec: parseSpec(args.spec), files: SOURCE })
  }

  beforeEach(() => sandbox.reset())

  it('installs, builds and answers with the sorted outDir tree', async () => {
    const result = await run({
      spec: { build: { ...BUILD, install: 'bun install' } },
      result: sandboxResult({
        install: finishedCommand({ stdout: 'prepared' }),
        outDir: builtFiles([
          { path: 'index.html', body: '<h1>built</h1>' },
          { path: 'assets/app.js', body: 'console.log(1)' },
        ]),
      }),
    })

    if (result.status !== 'ready') throw new Error(result.failure)
    expect(result.files.map((file) => file.path)).toEqual(['assets/app.js', 'index.html'])
    expect(result.log).toContain('prepared')
    expect(result.log).toContain('==> build (exit 0)')
    expect(sandbox.lastRequest.owner).toEqual({ threadId: 'thread-a' })
    expect(sandbox.lastRequest.files.map((file) => file.path)).toEqual(['index.html', 'app.css'])
  })

  it('fails with the last stderr line of the stage that broke', async () => {
    const result = await run({
      spec: { build: BUILD },
      result: sandboxResult({
        build: finishedCommand({ exitCode: 2, stderr: 'error: could not resolve ./x.css\n' }),
      }),
    })

    expect(result).toMatchObject({
      status: 'failed',
      failure: 'build failed with exit code 2: error: could not resolve ./x.css',
    })
  })

  it('fails a timed-out install and an empty outDir', async () => {
    const timedOut = await run({
      spec: { build: { ...BUILD, install: 'bun install', timeoutSec: 30 } },
      result: sandboxResult({ install: { ...finishedCommand(), timedOut: true } }),
    })
    const empty = await run({ spec: { build: BUILD }, result: sandboxResult({ outDir: [] }) })

    expect(timedOut).toMatchObject({ status: 'failed', failure: 'install timed out after 30s' })
    expect(empty).toMatchObject({
      status: 'failed',
      failure: 'build.outDir dist is missing or empty after the build',
    })
  })

  it('clamps a build timeout to the sandbox ceiling and says so in the log', async () => {
    await run({ spec: { build: { ...BUILD, timeoutSec: 900 } }, result: sandboxResult({}) })

    expect(sandbox.lastRequest.timeoutMs).toBe(ARTIFACT_BUILD_CLAMP_MS)
    expect(sandbox.lastRequest.env.HOME).toBe(ARTIFACT_WORKSPACE)
  })
})

describe('capArtifactLog', () => {
  it('keeps a short log whole and trims a long one to the cap', () => {
    expect(capArtifactLog({ log: 'two\nlines', header: null, exitCode: 0 })).toBe('two\nlines')

    const long = capArtifactLog({
      log: 'x'.repeat(400),
      header: null,
      exitCode: 1,
      capBytes: 200,
    })

    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(200)
    expect(long).toContain('log truncated')
    expect(ARTIFACT_LOG_CAP_BYTES).toBe(64 * 1024)
  })
})
