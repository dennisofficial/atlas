import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, ProcessPort, type ProcessHandle } from '@dltech/atlas-core'
import { ARTIFACT_LOG_MAX_CHARS } from '@dltech/atlas-wire'

import { LocalProcessPort } from '../../execution/local-process'
import { shellEnvironment } from '../../shells/shell-process'
import { runLocalBuild } from '../artifact-local-build'

import { FakeProcesses } from '../../tools/builtin/__tests__/artifact-fakes'

const withDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-artifact-build-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const processes = new LocalProcessPort()

const neverClosing = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({ start: () => undefined })

class HangingProcesses extends ProcessPort {
  terminations = 0

  spawn(): ProcessHandle {
    let terminate = (): void => undefined
    const exited = new Promise<number>((resolve) => {
      terminate = () => {
        this.terminations += 1
        resolve(0)
      }
    })
    return { stdout: neverClosing(), stderr: neverClosing(), exited, terminate: () => terminate() }
  }

  which(): string | null {
    return null
  }
}

describe('runLocalBuild', () => {
  it('runs install and then the build command, and the build writes into the directory', async () => {
    await withDir(async (dir) => {
      const result = await runLocalBuild({
        dir,
        build: {
          install: 'printf installed > install.txt',
          cmd: 'printf built > out.txt',
          timeoutSec: 30,
        },
        processes,
        signal: new AbortController().signal,
      })

      expect(result.ok).toBe(true)
      expect(await readFile(join(dir, 'install.txt'), 'utf8')).toBe('installed')
      expect(await readFile(join(dir, 'out.txt'), 'utf8')).toBe('built')
      expect(result.log).toContain('==> install (exit 0)')
      expect(result.log).toContain('==> build (exit 0)')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  it('runs the build like the bash tool does, in the directory, with the shell environment', async () => {
    const fakes = new FakeProcesses()

    await runLocalBuild({
      dir: '/ws/app',
      build: { cmd: 'bun run build', timeoutSec: 30 },
      processes: fakes as never,
      threadId: toThreadId('thr_1'),
      signal: new AbortController().signal,
    })

    expect(fakes.spawns).toEqual([
      {
        cmd: ['bash', '-c', 'bun run build'],
        cwd: '/ws/app',
        env: shellEnvironment(),
        threadId: 'thr_1',
      },
    ])
  })

  it('fails with the log when the build exits non-zero', async () => {
    await withDir(async (dir) => {
      const result = await runLocalBuild({
        dir,
        build: { cmd: 'printf broken >&2; exit 3', timeoutSec: 30 },
        processes,
        signal: new AbortController().signal,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.failure).toBe('build failed with exit code 3')
      expect(result.log).toContain('==> build (exit 3)')
      expect(result.log).toContain('broken')
    })
  })

  it('never runs the build command when install fails', async () => {
    await withDir(async (dir) => {
      const result = await runLocalBuild({
        dir,
        build: { install: 'printf no >&2; exit 1', cmd: 'touch ran', timeoutSec: 30 },
        processes,
        signal: new AbortController().signal,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.failure).toBe('install failed with exit code 1')
      expect(result.log).not.toContain('==> build (')
      expect(existsSync(join(dir, 'ran'))).toBe(false)
    })
  })

  it('terminates the build and fails when the timeout runs out', async () => {
    await withDir(async (dir) => {
      const startedAt = Date.now()
      const result = await runLocalBuild({
        dir,
        build: { cmd: 'sleep 30', timeoutSec: 0.3 },
        processes,
        signal: new AbortController().signal,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.failure).toContain('timed out after')
      expect(result.log).toContain('timed out')
      expect(Date.now() - startedAt).toBeLessThan(10_000)
    })
  })

  it('keeps only the tail of a long log, ending with the last output and the step header', async () => {
    await withDir(async (dir) => {
      const result = await runLocalBuild({
        dir,
        build: {
          cmd: "printf HEAD; head -c 200000 /dev/zero | tr '\\0' x; printf TAIL",
          timeoutSec: 30,
        },
        processes,
        signal: new AbortController().signal,
      })

      expect(result.ok).toBe(true)
      expect(result.log.length).toBeLessThanOrEqual(ARTIFACT_LOG_MAX_CHARS)
      expect(result.log.endsWith('\n==> build (exit 0)\n')).toBe(true)
      expect(result.log).toContain('TAIL')
      expect(result.log).not.toContain('HEAD')
    })
  })

  it('returns after terminate even when a forked process keeps the output pipe open', async () => {
    const hanging = new HangingProcesses()

    const startedAt = Date.now()
    const result = await runLocalBuild({
      dir: '/ws/app',
      build: { cmd: 'sleep 60 &', timeoutSec: 0.1 },
      processes: hanging,
      signal: new AbortController().signal,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe('build timed out after 0.1s')
    expect(result.log).toContain('==> build (timed out)')
    expect(hanging.terminations).toBe(1)
    expect(Date.now() - startedAt).toBeLessThan(3_000)
  })
})
