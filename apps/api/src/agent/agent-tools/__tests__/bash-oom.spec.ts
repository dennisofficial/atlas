import { describe, expect, it } from 'bun:test'

import {
  EProcessOutcome,
  ProcessPort,
  toThreadId,
  type OomMemory,
  type ProcessHandle,
  type ProcessOutcome,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { BashTool } from '../bash'
import { renderModelText } from '../bash-output'
import { files, launcher, useTempAtlasHome } from './support'

useTempAtlasHome()

const MEMORY: OomMemory = { commandLimitBytes: 2_490_195_968, podBytes: 4_100_808_704 }
const LIMIT_PHRASE = "commands may use 2.3 GB of the pod's 4 GB"

const emptyStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({ start: (sink) => sink.close() })

class OomProcessPort extends ProcessPort {
  spawn(): ProcessHandle {
    return {
      stdout: emptyStream(),
      stderr: emptyStream(),
      exited: Promise.resolve(137),
      outcome: Promise.resolve({ kind: EProcessOutcome.OomKilled, memory: MEMORY }),
      terminate: () => undefined,
    }
  }

  which(): string | null {
    return null
  }
}

class KilledByWatcherProcessPort extends ProcessPort {
  private settle: () => void = () => {}

  spawn(): ProcessHandle {
    const outcome = new Promise<ProcessOutcome>((resolve) => {
      this.settle = () => resolve({ kind: EProcessOutcome.OomKilled, memory: MEMORY })
    })
    return {
      stdout: emptyStream(),
      stderr: emptyStream(),
      exited: outcome.then(() => 137),
      outcome,
      terminate: () => this.settle(),
    }
  }

  which(): string | null {
    return null
  }
}

const run = (args: {
  processes: ProcessPort
  input: { description: string; command: string; timeoutMs?: number | undefined }
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> =>
  new BashTool({ launcher, files, processes: args.processes }).invoke({
    input: args.input,
    signal: args.signal ?? new AbortController().signal,
    idempotencyKey: 'bash-oom-1',
    projectDirectory: '/tmp',
    threadId: toThreadId('thread-1'),
  })

describe('bash out-of-memory result', () => {
  it('flags oomKilled in the output and names the command memory limit in the model text', async () => {
    const outcome = await run({
      processes: new OomProcessPort(),
      input: { description: 'Balloon memory', command: 'python balloon.py' },
    })

    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toMatchObject({ exitCode: 137, oomKilled: true })
    expect(outcome.modelText).toContain('`python balloon.py`')
    expect(outcome.modelText).toContain('out of memory')
    expect(outcome.modelText).toContain(LIMIT_PHRASE)
    expect(outcome.modelText).toContain('Only the operator can give the pod more memory')
  }, 30_000)

  it('a foreground command OOM-killed as its timeout fires is reported as out of memory, not a timeout', async () => {
    const outcome = await run({
      processes: new KilledByWatcherProcessPort(),
      input: { description: 'Balloon memory', command: 'python balloon.py', timeoutMs: 5 },
    })

    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toMatchObject({ exitCode: 137, oomKilled: true, timedOut: false })
    expect(outcome.modelText).toContain('out of memory')
    expect(outcome.modelText).not.toContain('timeout')
  }, 30_000)

  it('a foreground command OOM-killed while the turn is interrupted is reported as out of memory', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    const outcome = await run({
      processes: new KilledByWatcherProcessPort(),
      input: { description: 'Balloon memory', command: 'python balloon.py' },
      signal: controller.signal,
    })

    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toMatchObject({ oomKilled: true })
    expect(outcome.modelText).toContain('out of memory')
  }, 30_000)

  it('renders no memory advice for an ordinary failure', () => {
    const text = renderModelText({
      command: 'false',
      merged: '',
      exitCode: 1,
      timedOut: false,
      oomKilled: false,
      memory: undefined,
      timeoutMs: 1,
      maximumTimeoutMs: 2,
    })

    expect(text).toBe('Exit code: 1')
  })
})
