import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  attachDurableShell,
  EAttachFailure,
  EExitCause,
  EShellPhase,
  inspectDurableShell,
  launchDurableShell,
  META_FILE,
  STATUS_FILE,
  TOKEN_FILE,
  type LaunchSpec,
} from '../client'
import { collect, launchOrThrow, scratchDirectory } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function scratch(): Promise<string> {
  const made = await scratchDirectory()
  cleanups.push(made.cleanup)
  return made.shellDir
}

async function waitForExit({ shellDir }: { shellDir: string }) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const exit = (await inspectDurableShell({ shellDir })).status?.exit
    if (exit !== undefined) return exit
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return undefined
}

describe('launch environment and injection', () => {
  test('the env argument replaces the inherited environment for supervisor and child', async () => {
    const shellDir = await scratch()
    process.env.DURABLE_SPEC_SECRET = 'leaked'
    try {
      const handle = await launchOrThrow({
        shellDir,
        env: { PATH: process.env.PATH, DURABLE_SPEC_VISIBLE: 'yes' },
        command: 'echo "visible=$DURABLE_SPEC_VISIBLE secret=${DURABLE_SPEC_SECRET:-none}"',
      })
      expect(await collect({ stream: handle.stdout })).toBe('visible=yes secret=none\n')
    } finally {
      delete process.env.DURABLE_SPEC_SECRET
    }
  })

  test('the injected launch receives cmd, cwd and env and is used instead of a direct spawn', async () => {
    const shellDir = await scratch()
    const seen: LaunchSpec[] = []
    const outcome = await launchDurableShell({
      shellDir,
      command: 'echo injected',
      cwd: shellDir,
      pollMs: 20,
      env: { PATH: process.env.PATH, MARKER: 'm' },
      launch: async (spec) => {
        seen.push(spec)
        const [executable, ...rest] = spec.cmd
        const child = spawn(executable ?? '', rest, { detached: true, stdio: 'ignore', cwd: spec.cwd, env: spec.env })
        child.unref()
      },
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.env?.MARKER).toBe('m')
    expect(seen[0]?.cmd.at(-1)).toBe(join(shellDir, 'config.json'))
    expect(await collect({ stream: outcome.handle.stdout })).toBe('injected\n')
  })

  test('a launch that never starts a supervisor fails and leaves a cancel marker', async () => {
    const shellDir = await scratch()
    const outcome = await launchDurableShell({
      shellDir,
      command: 'echo never',
      cwd: shellDir,
      startTimeoutMs: 300,
      launch: async () => undefined,
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe(EAttachFailure.StartFailed)
    expect(await Bun.file(join(shellDir, 'cancel')).exists()).toBe(true)
  })

  test('a failing launch callback is reported as a start failure', async () => {
    const shellDir = await scratch()
    const outcome = await launchDurableShell({
      shellDir,
      command: 'true',
      cwd: shellDir,
      launch: async () => {
        throw new Error('no exec channel')
      },
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('no exec channel')
  })
})

describe('deadlines', () => {
  test('timeoutMs ends the shell with the timeout cause even after the launcher is gone', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, timeoutMs: 300, tickMs: 50, command: 'sleep 300' })
    await handle.detach()
    expect((await waitForExit({ shellDir }))?.cause).toBe(EExitCause.Timeout)
  })

  test('silenceMs ends a shell whose spool stops changing', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, silenceMs: 400, tickMs: 50, command: 'echo once; sleep 300' })
    await handle.detach()
    expect((await waitForExit({ shellDir }))?.cause).toBe(EExitCause.Silence)
  })

  test('steady output keeps a shell from being silenced', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({
      shellDir,
      silenceMs: 500,
      tickMs: 50,
      command: 'for i in 1 2 3 4 5 6 7 8; do echo tick; sleep 0.15; done',
    })
    expect(await handle.exited).toBe(0)
    expect((await waitForExit({ shellDir }))?.cause).toBe(EExitCause.Natural)
  })
})

describe('attach authentication and terminal-only handles', () => {
  test('a terminal shell attaches without a control token and reads the spool from the shell directory', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'echo archived; exit 4' })
    await handle.exited
    await rm(join(shellDir, TOKEN_FILE))
    const attached = await attachDurableShell({ shellDir, pollMs: 20 })
    if (!attached.ok) throw new Error(attached.reason)
    expect(await attached.handle.exited).toBe(4)
    expect(await collect({ stream: attached.handle.stdout })).toBe('archived\n')
    expect((await attached.handle.writeInput('x')).ok).toBe(false)
    expect(attached.handle.snapshot().phase).toBe(EShellPhase.Exited)
  })

  test('terminal attach ignores a stale spoolPath inside meta.json', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'echo moved' })
    await handle.exited
    const metaPath = join(shellDir, META_FILE)
    const meta = JSON.parse(await Bun.file(metaPath).text()) as Record<string, unknown>
    await writeFile(metaPath, JSON.stringify({ ...meta, spoolPath: '/nonexistent/spool.out', socketPath: '/nonexistent/s' }))
    const attached = await attachDurableShell({ shellDir, pollMs: 20 })
    if (!attached.ok) throw new Error(attached.reason)
    expect(await collect({ stream: attached.handle.stdout })).toBe('moved\n')
  })

  test('a running shell without its token cannot be attached', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    await rm(join(shellDir, TOKEN_FILE))
    expect((await attachDurableShell({ shellDir, pollMs: 20 })).ok).toBe(false)
    process.kill(-handle.pid, 'SIGKILL')
  })

  test('a status identity that disagrees with meta is refused', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const statusPath = join(shellDir, STATUS_FILE)
    const status = JSON.parse(await Bun.file(statusPath).text()) as Record<string, unknown>
    await writeFile(statusPath, JSON.stringify({ ...status, identity: 'f'.repeat(48) }))
    const attached = await attachDurableShell({ shellDir, pollMs: 20 })
    expect(attached.ok).toBe(false)
    if (!attached.ok) expect(attached.code).toBe(EAttachFailure.IdentityMismatch)
    process.kill(-handle.pid, 'SIGKILL')
  })

  test('a wrong token fails the authenticated attach instead of returning a handle', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    await writeFile(join(shellDir, TOKEN_FILE), 'not-the-token', { mode: 0o600 })
    expect((await attachDurableShell({ shellDir, pollMs: 20 })).ok).toBe(false)
    process.kill(-handle.pid, 'SIGKILL')
  })

  test('an orphaned child with a dead supervisor attaches as a lost handle, not a running one', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const inspection = await inspectDurableShell({ shellDir })
    process.kill(inspection.meta?.supervisor.pid ?? 0, 'SIGKILL')
    await handle.settled
    const attached = await attachDurableShell({ shellDir, pollMs: 20 })
    if (!attached.ok) throw new Error(attached.reason)
    expect((await attached.handle.settled).kind).toBe('lost')
    expect(await attached.handle.exited).toBe(-1)
    process.kill(-handle.pid, 'SIGKILL')
  })
})

describe('fast children', () => {
  test('instantly exiting commands always settle with the exact code and output', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const shellDir = await scratch()
        const handle = await launchOrThrow({ shellDir, command: index % 2 === 0 ? 'true' : `echo n${index}; exit ${index}` })
        const code = await Promise.race([
          handle.exited,
          new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 8000)),
        ])
        return { index, code, out: await collect({ stream: handle.stdout }) }
      }),
    )
    for (const { index, code, out } of results) {
      expect(code).toBe(index % 2 === 0 ? 0 : index)
      expect(out).toBe(index % 2 === 0 ? '' : `n${index}\n`)
    }
  })
})
