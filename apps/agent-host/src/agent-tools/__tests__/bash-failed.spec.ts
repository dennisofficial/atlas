import { describe, expect, it } from 'bun:test'

import {
  CallInterruptedError,
  EProcessOutcome,
  ProcessPort,
  toThreadId,
  type ProcessHandle,
  type ProcessOutcome,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { BashTool } from '../bash'
import { ForegroundOnlyShells } from '../../runtime/foreground-shells'
import { files, useTempAtlasHome } from './support'

useTempAtlasHome()

class OutcomePort extends ProcessPort {
  constructor(private readonly outcome: ProcessOutcome) {
    super()
  }

  spawn(): ProcessHandle {
    const outcome = Promise.resolve(this.outcome)
    const exited = outcome.then((settled) => {
      if (settled.kind === EProcessOutcome.Exited) return settled.code
      throw new Error('no exit code')
    })
    exited.catch(() => undefined)
    return {
      stdout: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited,
      outcome,
      terminate: () => undefined,
    }
  }

  which(): string | null {
    return null
  }
}

const run = (outcome: ProcessOutcome): Promise<ToolOutcome> =>
  new BashTool(new ForegroundOnlyShells(), files, new OutcomePort(outcome)).invoke({
    input: { description: 'Run it', command: 'make build' },
    signal: new AbortController().signal,
    idempotencyKey: 'bash-failed-1',
    projectDirectory: '/tmp',
    threadId: toThreadId('thread-1'),
  })

describe('bash when the command never completed', () => {
  it('renders the failure message to the model instead of exit code 1', async () => {
    const outcome = await run({
      kind: EProcessOutcome.Failed,
      code: 'output-lost',
      message: 'the daemon lost the output of the command',
    })

    if (outcome.ok) throw new Error('expected a failure')
    expect(outcome.reason).toContain('the daemon lost the output of the command')
    expect(outcome.reason).toContain('output-lost')
    expect(outcome.reason).not.toContain('Exit code')
  }, 30_000)

  it('throws CallInterruptedError for an interrupted command', async () => {
    await expect(run({ kind: EProcessOutcome.Interrupted })).rejects.toBeInstanceOf(
      CallInterruptedError,
    )
  }, 30_000)

  it('still reports a normal exit code', async () => {
    const outcome = await run({ kind: EProcessOutcome.Exited, code: 2 })

    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.modelText).toContain('Exit code: 2')
  }, 30_000)
})
