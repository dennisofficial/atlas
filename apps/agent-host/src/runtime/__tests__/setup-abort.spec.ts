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

describe('SessionRuntime.prepare after the setup deadline', () => {
  it('aborts the attempt at the deadline and starts the next one only after it settled', async () => {
    const sandbox = new LocalSandboxProvider({ daemonSecret: 'abort-secret' })
    const log = new CollectingLog()
    const reads: string[] = []
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
        timers: { now: () => Date.now(), ...systemTimers },
        modelFor: () => new ScriptedModel([]),
        launchDirectory: mkdtempSync(join(tmpdir(), 'atlas-abort-')),
        setupDeadlineMs: 300,
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
      const failed = await first
      expect(failed).toEqual({
        ok: false,
        reason: 'workspace setup did not finish within 300ms',
      })
      expect(reads).toEqual(['read'])
      const second = runtime.prepare()
      expect(second).not.toBe(first)
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
