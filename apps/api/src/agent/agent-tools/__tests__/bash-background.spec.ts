import { EProcessOutcome, toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'bun:test'

import { BashTool } from '../bash'
import { files, launcher, useTempAtlasHome } from './support'
import { HandoverPort, type HandoverArgs } from './support-handover'

useTempAtlasHome()

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-bash-background-'))
})

const run = (args: {
  port: HandoverPort
  input: Record<string, unknown>
  signal?: AbortSignal
  idempotencyKey?: string
}): Promise<ToolOutcome> =>
  new BashTool({ launcher, files, processes: args.port }).invoke({
    input: { description: 'Run the suite', ...args.input },
    signal: args.signal ?? new AbortController().signal,
    idempotencyKey: args.idempotencyKey ?? 'bash-1',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })

const outputOf = (outcome: ToolOutcome): Record<string, unknown> => {
  if (!outcome.ok) throw new Error(`expected a successful outcome, got: ${outcome.reason}`)
  return outcome.output as Record<string, unknown>
}

const withWindow = (args: HandoverArgs): HandoverPort => new HandoverPort(args)

describe('a bash call that outlives its wait window', () => {
  it('a command still running at its wait window continues as a background shell instead of being killed', async () => {
    const port = withWindow({ adopt: true, before: 'compiling\n' })

    const outcome = await run({ port, input: { command: 'bun test', timeoutMs: 50 } })

    const output = outputOf(outcome)
    expect(output).toMatchObject({
      command: 'bun test',
      description: 'Run the suite',
      backgrounded: true,
      stdout: 'compiling\n',
      stderr: '',
      truncated: false,
      timedOut: false,
    })
    expect(String(output.shellId)).toMatch(/^shell-[0-9a-f]{8}$/)
    expect(port.adopted).toEqual([String(output.shellId)])
    expect(port.terminated).toEqual([])
    expect(outcome.ok && outcome.modelText).toContain(
      `continues as background shell ${String(output.shellId)}`,
    )
    expect(outcome.ok && outcome.modelText).toContain('<system-untrusted source="bash">')
    expect(outcome.ok && outcome.modelText).toContain(
      `shell_output({ shellId: "${String(output.shellId)}" })`,
    )
  }, 15_000)

  it('falls back to killing it at the deadline when the sandbox cannot adopt it', async () => {
    const port = withWindow({ adopt: false })

    const outcome = await run({ port, input: { command: 'sleep 30', timeoutMs: 50 } })

    const output = outputOf(outcome)
    expect(output).toMatchObject({ timedOut: true })
    expect(output.backgrounded).toBeUndefined()
    expect(output.shellId).toBeUndefined()
    expect(port.terminated).toHaveLength(1)
    expect(outcome.ok && outcome.modelText).toContain('killed after exceeding its 50 ms timeout')
  }, 15_000)

  it('the operator interrupt still kills a command', async () => {
    const controller = new AbortController()
    const port = withWindow({ adopt: true })
    setTimeout(() => controller.abort(), 50)

    const outcome = await run({
      port,
      input: { command: 'sleep 30', timeoutMs: 30_000 },
      signal: controller.signal,
      idempotencyKey: 'bash-2',
    })

    expect(outcome).toEqual({
      ok: false,
      reason: 'the operator interrupted the turn while the command was running',
    })
    expect(port.terminated).toHaveLength(1)
    expect(port.adopted).toEqual([])
  }, 15_000)

  it('an OOM that lands as the window closes is reported as out of memory', async () => {
    const memory = { commandLimitBytes: 2_490_195_968, podBytes: 4_100_808_704 }
    const port = withWindow({
      adopt: true,
      endsWith: { kind: EProcessOutcome.OomKilled, memory, afterMs: 10 },
    })

    const outcome = await run({ port, input: { command: 'bun test', timeoutMs: 2_000 } })

    expect(outputOf(outcome)).toMatchObject({ oomKilled: true })
    expect(outcome.ok && outcome.modelText).toContain('ran out of memory')
    expect(port.adopted).toEqual([])
  }, 15_000)
})
