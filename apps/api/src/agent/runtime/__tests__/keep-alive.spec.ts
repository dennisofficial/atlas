import { describe, expect, it } from 'bun:test'

import type { HostTimers } from '@dltech/atlas-host'
import { LogPort } from '@dltech/atlas-observability'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import {
  SandboxProvider,
  type DaemonEndpoint,
  type SandboxTarget,
  type PodResizeOutcome,
} from '../../sandbox/sandbox-provider'
import { POD_IDLE_WINDOW_MS, startKeepAlive } from '../keep-alive'

class RecordingSandbox extends SandboxProvider {
  pushed: number[] = []
  stopped: string[] = []
  failure: Error | undefined

  wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    return new Promise(() => {})
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    this.stopped.push(args.target.sandboxSessionId)
  }

  async keepAlive(args: { target: SandboxTarget; until: number }): Promise<void> {
    if (this.failure !== undefined) throw this.failure
    this.pushed.push(args.until)
  }

  async resize(_args: { target: SandboxTarget; vcpus: number }): Promise<PodResizeOutcome> {
    return 'restarted'
  }
}

class RecordingLog extends LogPort {
  entries: Parameters<LogPort['record']>[0][] = []

  record(entry: Parameters<LogPort['record']>[0]): void {
    this.entries.push(entry)
  }
}

const NOW = 1_700_000_000_000

const TARGET: SandboxTarget = {
  sandboxSessionId: 's-keep',
  credentials: { provider: ESandboxProvider.Agent37, apiKey: 'agent37-key' },
}

const fakeTimers = (): { timers: HostTimers; fire: () => void } => {
  const scheduled: (() => void)[] = []
  return {
    timers: {
      now: () => NOW,
      setTimeout: (handler) => {
        scheduled.push(handler)
        return handler
      },
      clearTimeout: (timer) => {
        const index = scheduled.indexOf(timer as () => void)
        if (index >= 0) scheduled.splice(index, 1)
      },
      random: () => 0,
    },
    fire: () => {
      for (const handler of [...scheduled]) handler()
    },
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const keepAliveOf = (args: { sandbox: RecordingSandbox; signal?: AbortSignal }) => {
  const { timers, fire } = fakeTimers()
  const log = new RecordingLog()
  const keepAlive = startKeepAlive({
    sandbox: args.sandbox,
    target: TARGET,
    timers,
    signal: args.signal ?? new AbortController().signal,
    log,
  })
  return { keepAlive, fire, log }
}

describe('the pod deadline while a host holds a session', () => {
  it('pushes the deadline once when the runtime opens', async () => {
    const sandbox = new RecordingSandbox()
    keepAliveOf({ sandbox })
    await flush()
    expect(sandbox.pushed).toEqual([NOW + POD_IDLE_WINDOW_MS])
  })

  it('renews every ten minutes while held', async () => {
    const sandbox = new RecordingSandbox()
    const { fire } = keepAliveOf({ sandbox })
    await flush()
    fire()
    await flush()
    expect(sandbox.pushed).toEqual([NOW + POD_IDLE_WINDOW_MS, NOW + POD_IDLE_WINDOW_MS])
  })

  it('pushes the deadline on release and never stops the pod', async () => {
    const sandbox = new RecordingSandbox()
    const { keepAlive, fire } = keepAliveOf({ sandbox })
    await flush()
    await keepAlive.release()
    fire()
    await flush()
    expect(sandbox.pushed).toEqual([NOW + POD_IDLE_WINDOW_MS, NOW + POD_IDLE_WINDOW_MS])
    expect(sandbox.stopped).toEqual([])
  })

  it('logs a failed final renewal instead of throwing', async () => {
    const sandbox = new RecordingSandbox()
    const { keepAlive, log } = keepAliveOf({ sandbox })
    sandbox.failure = new Error('deadline refused')
    await expect(keepAlive.release()).resolves.toBeUndefined()
    expect(log.entries.map((entry) => entry.source)).toEqual(['runtime.keep-alive'])
  })

  it('arms nothing when the runtime already ended', async () => {
    const sandbox = new RecordingSandbox()
    const aborted = new AbortController()
    aborted.abort()
    const { fire } = keepAliveOf({ sandbox, signal: aborted.signal })
    fire()
    await flush()
    expect(sandbox.pushed).toEqual([])
  })
})
