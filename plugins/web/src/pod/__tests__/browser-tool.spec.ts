import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EMPTY_MCP_CONTROL, type PluginPodContext } from '@dltech/atlas-plugin-sdk'
import {
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type CallOp,
  type CallResult,
  type DaemonEventFrame,
  type LiveFrame,
} from '@dltech/atlas-protocol'

import { BrowserTool } from '../browser-tool'

const execOk = (exitCode: number | null, outcome = EExecOutcome.Exited): CallResult => ({
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode, signal: null, outcome, outputBytes: 0 },
})

const ctxOf = (args: {
  result: CallResult
  output?: string
  seen?: CallOp[]
}): PluginPodContext => {
  const unsupported = (): never => {
    throw new Error('not part of this spec')
  }
  return {
    sessionId: 'ses_42',
    control: {
      exposePort: unsupported,
      memory: {} as never,
      mcp: EMPTY_MCP_CONTROL,
      webSearch: { config: async () => ({ backend: 'bing', key: undefined }) },
    },
    crew: {} as never,
    sessions: {} as never,
    worktrees: {} as never,
    append: unsupported,
    events: () => [],
    call: async (op, options) => {
      args.seen?.push(op)
      if (args.output !== undefined) options?.onOutput?.(new TextEncoder().encode(args.output))
      return args.result
    },
    live: (_frame: LiveFrame) => undefined,
    onDaemonEvent: (_listener: (frame: DaemonEventFrame) => void) => () => undefined,
    log: () => undefined,
  }
}

const invoke = (
  tool: BrowserTool,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; [key: string]: unknown }> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  }) as Promise<{ ok: boolean; [key: string]: unknown }>

describe('BrowserTool', () => {
  it('runs agent-browser in a browser named for the session', async () => {
    const seen: CallOp[] = []
    const tool = new BrowserTool(ctxOf({ result: execOk(0), output: 'atlas', seen }))

    const outcome = await invoke(tool, { args: ['open', 'example.com'] })

    expect(outcome.ok).toBe(true)
    expect(seen[0]).toEqual({
      op: 'exec',
      argv: ['agent-browser', '--session', 'atlas-ses_42', 'open', 'example.com'],
      timeoutMs: 120_000,
    })
    expect(String(outcome.modelText)).toContain('atlas')
  })

  it('refuses a caller-chosen session', async () => {
    const seen: CallOp[] = []
    const tool = new BrowserTool(ctxOf({ result: execOk(0), seen }))

    const outcome = await invoke(tool, { args: ['open', '--session', 'other', 'example.com'] })

    expect(outcome.ok).toBe(false)
    expect(String(outcome.reason)).toContain('--session')
    expect(seen).toHaveLength(0)
  })

  it('drops the middle of a long page and says so', async () => {
    const long = `${'a'.repeat(16_000)}${'b'.repeat(6_000)}${'c'.repeat(4_000)}`
    const tool = new BrowserTool(ctxOf({ result: execOk(0), output: long }))

    const outcome = await invoke(tool, { args: ['read'] })

    expect(outcome.ok).toBe(true)
    expect((outcome.output as { truncated: boolean }).truncated).toBe(true)
    expect(String(outcome.modelText)).toContain('characters dropped from the middle')
  })

  it('fails with a retry hint when the call times out', async () => {
    const tool = new BrowserTool(
      ctxOf({ result: execOk(null, EExecOutcome.TimedOut), output: 'partial' }),
    )

    const outcome = await invoke(tool, { args: ['wait'], timeoutMs: 2_000 })

    expect(outcome.ok).toBe(false)
    expect(String(outcome.reason)).toContain('2000ms')
  })

  it('reports a failed exec with the daemon message', async () => {
    const tool = new BrowserTool(
      ctxOf({
        result: {
          status: ECallStatus.Failed,
          op: 'exec',
          error: {
            code: ECallFailure.SpawnFailed,
            message: 'command not found: agent-browser',
          },
        },
      }),
    )

    const outcome = await invoke(tool, { args: ['open', 'example.com'] })

    expect(outcome.ok).toBe(false)
    expect(String(outcome.reason)).toContain('agent-browser')
  })
})
