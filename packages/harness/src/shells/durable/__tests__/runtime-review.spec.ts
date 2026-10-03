import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { startTimeOf } from '../../../workspace/process-identity'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

import {
  attachDurableShell,
  EAttachFailure,
  EControlError,
  EExitCause,
  launchDurableShell,
  defaultSupervisorCommand,
  type AttachArgs,
  type ControlResult,
} from '../client'
import { collect, launchOrThrow, readUntil } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'durable-review-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return join(root, 'shell')
}

async function supervisorPid({ shellDir }: { shellDir: string }): Promise<number> {
  const status = JSON.parse(await Bun.file(join(shellDir, 'status.json')).text()) as { supervisor?: { pid: number } }
  return status.supervisor?.pid ?? 0
}

function isAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor({ pass, attempts = 200 }: { pass: () => Promise<boolean>; attempts?: number }): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await pass()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

describe('cancel during a slow start', () => {
  test('a start timeout on a slow supervisor leaves a cancel marker and no orphan supervisor', async () => {
    const shellDir = await scratch()
    const outcome = await launchDurableShell({
      shellDir,
      command: 'sleep 300',
      cwd: shellDir,
      startTimeoutMs: 250,
      supervisorCommand: [process.execPath, '-e', 'setTimeout(() => undefined, 4000)'],
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.code).toBe(EAttachFailure.StartFailed)
    expect(await Bun.file(join(shellDir, 'cancel')).exists()).toBe(true)
    expect(await Bun.file(join(shellDir, 'status.json')).exists()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 4500))
    expect(await Bun.file(join(shellDir, 'status.json')).exists()).toBe(false)
  })
})

describe('launch callback failures', () => {
  test('a callback that spawns the supervisor and then rejects is cancelled', async () => {
    const shellDir = await scratch()
    const outcome = await launchDurableShell({
      shellDir,
      command: 'sleep 300',
      cwd: shellDir,
      startTimeoutMs: 400,
      launch: async (spec) => {
        const [executable, ...rest] = spec.cmd
        const child = spawn(executable ?? '', rest, { detached: true, stdio: 'ignore', cwd: spec.cwd, env: spec.env })
        child.unref()
        await new Promise((resolve) => setTimeout(resolve, 1200))
        throw new Error('exec channel broke after exec')
      },
    })
    expect(outcome.ok).toBe(false)
    expect(await Bun.file(join(shellDir, 'cancel')).exists()).toBe(true)
    const supervisorDied = await waitFor({
      pass: async () => {
        const status = JSON.parse(await Bun.file(join(shellDir, 'status.json')).text()) as {
          supervisor?: { pid: number }
          exit?: { cause?: string }
        }
        if (status.supervisor === undefined) return false
        return status.exit !== undefined || !isAlive({ pid: status.supervisor.pid })
      },
      attempts: 400,
    })
    expect(supervisorDied).toBe(true)
  })

  test('a directory whose token already exists is left alone when the callback throws', async () => {
    const scratchDir = await scratch()
    const occupied = join(rootOf({ shellDir: scratchDir }), 'occupied')
    await rm(occupied, { recursive: true, force: true })
    await mkdir(occupied, { recursive: true })
    await Bun.write(join(occupied, 'control.token'), 'someone-else')
    const outcome = await launchDurableShell({
      shellDir: occupied,
      command: 'true',
      cwd: tmpdir(),
      launch: async () => {
        throw new Error('should never be reached')
      },
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.reason).not.toContain('should never be reached')
    expect(await Bun.file(join(occupied, 'cancel')).exists()).toBe(false)
    expect(await Bun.file(join(occupied, 'control.token')).text()).toBe('someone-else')
  })
})

function rootOf({ shellDir }: { shellDir: string }): string {
  return shellDir.slice(0, shellDir.lastIndexOf('/'))
}

describe('input acknowledgement', () => {
  test('input to a closed stdin is rejected with input-closed, never acknowledged', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'exec 0<&-; sleep 30' })
    const sent = await handle.writeInput('x'.repeat(512 * 1024))
    expect(sent.ok).toBe(false)
    if (!sent.ok) expect(sent.code).toBe(EControlError.InputClosed)
    handle.terminate()
    await handle.exited
  })

  test('input queued past the budget for a non-reading child is refused with backpressure', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 30' })
    const chunk = 'x'.repeat(512 * 1024)
    let refused: ControlResult | undefined
    for (let index = 0; index < 40; index += 1) {
      const sent = await handle.writeInput(chunk)
      if (!sent.ok) {
        refused = sent
        break
      }
    }
    expect(refused).toBeDefined()
    if (refused !== undefined && !refused.ok) expect(refused.code).toBe(EControlError.InputBackpressure)
    handle.terminate()
    await handle.exited
  })

  test('input that the child reads is acknowledged', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'read line; echo "got:$line"' })
    const { reader } = await readUntil({ stream: handle.stdout, pattern: '' })
    expect((await handle.writeInput('ping\n')).ok).toBe(true)
    let text = ''
    while (!text.includes('got:ping')) {
      const { done, value } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    expect(await handle.exited).toBe(0)
  })
})

describe('overlapping tick lifecycle', () => {
  test('a natural exit during a slow tick keeps its natural cause', async () => {
    const shellDir = await scratch()
    const lockDir = await mkdtemp(join(tmpdir(), 'durable-lock-'))
    cleanups.push(() => rm(lockDir, { recursive: true, force: true }))
    const bin = join(lockDir, 'bin')
    const marker = join(lockDir, 'tick-entered')
    await mkdir(bin)
    await writeFile(join(bin, 'ps'), [
      '#!/bin/sh',
      'if [ "$4" = "$DURABLE_LOCK_PID" ]; then',
      '  touch "$DURABLE_TICK_MARKER"',
      '  sleep 0.3',
      'fi',
      'exec /bin/ps "$@"',
    ].join('\n'), { mode: 0o700 })
    await writeFile(join(lockDir, 'lock'), JSON.stringify({
      pid: process.pid,
      start: await startTimeOf({ pid: process.pid }),
    }))
    const handle = await launchOrThrow({
      shellDir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        DURABLE_LOCK_PID: String(process.pid),
        DURABLE_TICK_MARKER: marker,
      },
      timeoutMs: 60,
      tickMs: 30,
      killGraceMs: 200,
      command: `while [ ! -f '${marker}' ]; do sleep 0.01; done; exit 0`,
      sessionLock: { lockFile: join(lockDir, 'lock') },
    })
    const exit = await waitForExit({ shellDir })
    expect(exit?.cause).toBe(EExitCause.Natural)
    expect(exit?.exitCode).toBe(0)
    if (exit?.cause === EExitCause.Timeout) {
      expect(isAlive({ pid: handle.pid })).toBe(false)
    }
  })

  test('a shell that does hit its deadline still records the timeout cause', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, timeoutMs: 150, tickMs: 30, command: 'sleep 30' })
    const exit = await waitForExit({ shellDir })
    expect(exit?.cause).toBe(EExitCause.Timeout)
    await handle.detach()
  })
})

async function waitForExit({ shellDir }: { shellDir: string }) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = JSON.parse(await Bun.file(join(shellDir, 'status.json')).text()) as { exit?: unknown }
    if (status.exit !== undefined) return status.exit as { cause: string; exitCode: number }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return undefined
}

describe('attach with an unknown probe answer', () => {
  test('a transport whose probe throws is unreachable, never lost', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const inspection = JSON.parse(await Bun.file(join(shellDir, 'meta.json')).text()) as { supervisor: { pid: number } }
    process.kill(inspection.supervisor.pid, 'SIGKILL')
    await handle.settled

    const base: AttachArgs = {
      shellDir,
      pollMs: 20,
      transport: async ({ request }): Promise<ControlResult> => {
        if (request.type === 'probe') throw new Error('exec channel dead')
        return { ok: false, code: EControlError.Unreachable, message: 'exec channel dead' }
      },
    }
    const outcome = await attachDurableShell(base)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe(EAttachFailure.Unreachable)
    process.kill(-handle.pid, 'SIGKILL')
  })

  test('a transport whose probe reports alive but unreachable control is unreachable, never lost', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const outcome = await attachDurableShell({
      shellDir,
      pollMs: 20,
      transport: async ({ request }): Promise<ControlResult> =>
        request.type === 'probe'
          ? { ok: true, probe: { supervisorAlive: true, childAlive: true, reachable: false } }
          : { ok: false, code: EControlError.Unreachable, message: 'cannot reach' },
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe(EAttachFailure.Unreachable)
    process.kill(-handle.pid, 'SIGKILL')
  })
})

describe('control entry point', () => {
  test('the default supervisor command still boots the source entry', async () => {
    const shellDir = await scratch()
    const outcome = await launchDurableShell({ shellDir, command: 'echo cli-ok', cwd: tmpdir(), pollMs: 20 })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(await collect({ stream: outcome.handle.stdout })).toBe('cli-ok\n')
    expect(defaultSupervisorCommand().length).toBe(2)
  })
})
