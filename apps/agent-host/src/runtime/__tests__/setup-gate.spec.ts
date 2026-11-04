import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EToolEffect,
  ToolDefinition,
  toThreadId,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers } from '@dltech/atlas-host'
import { z } from 'zod'

import { apiFor, CollectingLog } from '../../__tests__/e2e-support'
import { LocalSandboxProvider } from '../../testing/local-sandbox-provider'
import { createSessionRuntimeFactory } from '../session-runtime-factory'
import { SetupGatedTool } from '../tools'

const GATE_REASON = 'interrupted while the workspace was being set up'

const invocation = (signal: AbortSignal): ToolInvocation => ({
  input: { path: '/nonexistent/file' },
  signal,
  idempotencyKey: 'gate-test',
  projectDirectory: '/tmp',
  threadId: toThreadId('gate-thread'),
})

class FakeInnerTool extends ToolDefinition {
  readonly name = 'fake-read'
  readonly description = 'records invocations'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.object({ path: z.string() })
  calls = 0

  async invoke(_args: ToolInvocation): Promise<ToolOutcome> {
    this.calls += 1
    return { ok: true, output: {}, modelText: 'done' }
  }
}

describe('SetupGatedTool', () => {
  it('returns an interrupted outcome on abort without calling the inner tool', async () => {
    const inner = new FakeInnerTool()
    const open = new SetupGatedTool(inner, Promise.resolve())
    const outcome = await open.invoke(invocation(new AbortController().signal))
    expect(outcome.ok).toBe(true)
    expect(inner.calls).toBe(1)

    const stalled = new SetupGatedTool(inner, new Promise<void>(() => {}))
    const aborted = new AbortController()
    aborted.abort()
    const interrupted = await stalled.invoke(invocation(aborted.signal))
    expect(interrupted).toEqual({ ok: false, reason: GATE_REASON })
    expect(inner.calls).toBe(1)
  })

  it('lets a waiting tool through when the setup resolves', async () => {
    const inner = new FakeInnerTool()
    let release = (): void => {}
    const gated = new SetupGatedTool(
      inner,
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const pending = gated.invoke(invocation(new AbortController().signal))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(inner.calls).toBe(0)
    release()
    const outcome = await pending
    expect(outcome.ok).toBe(true)
    expect(inner.calls).toBe(1)
  })
})

describe('the setup gate deadline', () => {
  it('releases the tools when githubToken stalls past the deadline', async () => {
    const sandbox = new LocalSandboxProvider({ daemonSecret: 'gate-deadline-secret' })
    const log = new CollectingLog()
    try {
      const api = {
        ...apiFor(),
        githubToken: () => new Promise<{ token: string | null }>(() => {}),
      }
      const factory = createSessionRuntimeFactory({
        api,
        sandbox,
        daemonSecret: 'gate-deadline-secret',
        timers: { now: () => Date.now(), ...systemTimers },
        modelFor: () => new ScriptedModel([]),
        launchDirectory: mkdtempSync(join(tmpdir(), 'atlas-gate-deadline-')),
        setupDeadlineMs: 300,
        log,
      })
      const runtime = await factory({
        sessionId: 'gate-session-1',
        threadId: toThreadId('gate-thread'),
        epoch: 1,
        signal: new AbortController().signal,
      })
      const tool = runtime.tools.find('read')
      expect(tool).toBeDefined()
      const started = Date.now()
      const outcome = await tool?.invoke(invocation(new AbortController().signal))
      expect(Date.now() - started).toBeLessThan(15_000)
      expect(outcome?.ok === false && outcome.reason === GATE_REASON).toBe(false)
      expect(log.dump('gate')).toContain('did not finish within')
      await runtime.stop()
    } finally {
      await sandbox.stopAll()
    }
  }, 60_000)
})
