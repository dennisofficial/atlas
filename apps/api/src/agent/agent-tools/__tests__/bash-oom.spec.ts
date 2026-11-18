import { describe, expect, it } from 'bun:test'

import {
  EProcessOutcome,
  ProcessPort,
  toThreadId,
  type ProcessHandle,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { BashTool } from '../bash'
import { renderModelText } from '../bash-output'
import { ForegroundOnlyShells } from '../../runtime/foreground-shells'
import { files, useTempAtlasHome } from './support'

useTempAtlasHome()

class OomProcessPort extends ProcessPort {
  spawn(): ProcessHandle {
    return {
      stdout: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(137),
      outcome: Promise.resolve({ kind: EProcessOutcome.OomKilled }),
      terminate: () => undefined,
    }
  }

  which(): string | null {
    return null
  }
}

const run = (): Promise<ToolOutcome> =>
  new BashTool(new ForegroundOnlyShells(), files, new OomProcessPort()).invoke({
    input: { description: 'Balloon memory', command: 'python balloon.py' },
    signal: new AbortController().signal,
    idempotencyKey: 'bash-oom-1',
    projectDirectory: '/tmp',
    threadId: toThreadId('thread-1'),
  })

describe('bash out-of-memory result', () => {
  it('flags oomKilled in the output and says so in the model text', async () => {
    const outcome = await run()

    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toMatchObject({ exitCode: 137, oomKilled: true })
    expect(outcome.modelText).toContain('out of memory')
    expect(outcome.modelText).toContain('memory limit')
    expect(outcome.modelText).toContain('Exit code: 137')
  }, 30_000)

  it('renders no memory advice for an ordinary failure', () => {
    const text = renderModelText({
      merged: '',
      exitCode: 1,
      timedOut: false,
      oomKilled: false,
      timeoutMs: 1,
      maximumTimeoutMs: 2,
    })

    expect(text).toBe('Exit code: 1')
  })
})
