import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ProcessPort, toThreadId, type ProcessHandle } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers } from '@dltech/atlas-host'

import { CollectingLog, sourceFor, unusedTokens } from '../../__tests__/e2e-support'
import { LocalSandboxProvider } from '../../testing/local-sandbox-provider'
import { abortable } from '../abortable'
import { createSessionRuntimeFactory } from '../session-runtime-factory'
import { run } from '../workspace-clone'

class HangingProcesses extends ProcessPort {
  terminated = 0

  spawn(): ProcessHandle {
    let finish: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => {
      finish = resolve
    })
    const stdout = new ReadableStream<Uint8Array>({
      start: (controller) => {
        void exited.then(() => controller.close())
      },
    })
    return {
      stdout,
      stderr: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
      exited,
      terminate: () => {
        this.terminated += 1
        finish(143)
      },
    }
  }

  which(): string | null {
    return null
  }
}

describe('abortable', () => {
  it('rejects with the abort reason while the promise is still pending', async () => {
    const controller = new AbortController()
    const pending = abortable(new Promise<never>(() => {}), controller.signal)
    controller.abort(new Error('deadline'))
    await expect(pending).rejects.toThrow('deadline')
  })

  it('passes the value through when the promise settles first', async () => {
    expect(await abortable(Promise.resolve(7), new AbortController().signal)).toBe(7)
  })
})

describe('run', () => {
  it('terminates the spawned process when the signal aborts', async () => {
    const processes = new HangingProcesses()
    const controller = new AbortController()
    const outcome = run({
      processes,
      cmd: ['sleep', '30'],
      cwd: '/tmp',
      timeoutMs: 60_000,
      signal: controller.signal,
    })
    controller.abort()
    expect(await outcome).toEqual({ ok: false, output: '' })
    expect(processes.terminated).toBe(1)
  })
})

const DEADLINE_MS = 300

const manualDeadline = () => {
  const pending = new Map<unknown, () => void>()
  const timers = {
    now: () => Date.now(),
    random: systemTimers.random,
    setTimeout: (handler: () => void, ms: number): unknown => {
      if (ms !== DEADLINE_MS) return systemTimers.setTimeout(handler, ms)
      const handle = {}
      pending.set(handle, handler)
      return handle
    },
    clearTimeout: (handle: unknown): void => {
      if (pending.delete(handle)) return
      systemTimers.clearTimeout(handle)
    },
  }
  const expire = (): void => {
    const [entry] = [...pending]
    if (entry === undefined) throw new Error('no deadline is armed')
    pending.delete(entry[0])
    entry[1]()
  }
  return { timers, expire }
}

const until = async (check: () => boolean): Promise<void> => {
  const stop = Date.now() + 20_000
  while (!check()) {
    if (Date.now() > stop) throw new Error('timed out waiting for the attempt to read the token')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('SessionRuntime.prepare after the setup deadline', () => {
  it('aborts the attempt at the deadline and starts the next one only after it settled', async () => {
    const sandbox = new LocalSandboxProvider({ daemonSecret: 'abort-secret' })
    const log = new CollectingLog()
    const reads: string[] = []
    const deadline = manualDeadline()
    try {
      const factory = createSessionRuntimeFactory({
        config: sourceFor(),
        tokens: unusedTokens(),
        github: {
          read: () => {
            reads.push('read')
            return new Promise<string | null>(() => {})
          },
        },
        sandbox,
        daemonSecret: 'abort-secret',
        timers: deadline.timers,
        modelFor: () => new ScriptedModel([]),
        launchDirectory: mkdtempSync(join(tmpdir(), 'atlas-abort-')),
        setupDeadlineMs: DEADLINE_MS,
        log,
      })
      const runtime = await factory({
        sessionId: 'abort-session-1',
        threadId: toThreadId('abort-thread'),
        epoch: 1,
        signal: new AbortController().signal,
      })
      const first = runtime.prepare()
      expect(runtime.prepare()).toBe(first)
      await until(() => reads.length === 1)
      deadline.expire()
      const failed = await first
      expect(failed).toEqual({
        ok: false,
        reason: 'workspace setup did not finish within 300ms',
      })
      expect(reads).toEqual(['read'])
      const second = runtime.prepare()
      expect(second).not.toBe(first)
      await until(() => reads.length === 2)
      deadline.expire()
      expect(await second).toEqual({
        ok: false,
        reason: 'workspace setup did not finish within 300ms',
      })
      expect(reads).toEqual(['read', 'read'])
      await runtime.stop()
    } finally {
      await sandbox.stopAll()
    }
  }, 30_000)
})
