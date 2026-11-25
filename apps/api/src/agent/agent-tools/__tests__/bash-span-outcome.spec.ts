import { describe, expect, it } from 'bun:test'

import {
  EProcessOutcome,
  ProcessPort,
  toThreadId,
  type OomMemory,
  type ProcessHandle,
  type ToolOutcome,
  type ToolSpanDetail,
} from '@dltech/atlas-core'

import { BashTool } from '../bash'
import { files, launcher, processes, useTempAtlasHome } from './support'
import { HandoverPort } from './support-handover'

useTempAtlasHome()

const MEMORY: OomMemory = { commandLimitBytes: 2_490_195_968, podBytes: 4_100_808_704 }

const emptyStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({ start: (sink) => sink.close() })

class OomPort extends ProcessPort {
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

const run = (args: {
  input: Record<string, unknown>
  processes?: ProcessPort | undefined
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> =>
  new BashTool({ launcher, files, processes: args.processes ?? processes }).invoke({
    input: { description: 'Exercise the shell', ...args.input },
    signal: args.signal ?? new AbortController().signal,
    idempotencyKey: 'bash-span-detail-1',
    projectDirectory: '/tmp',
    threadId: toThreadId('thread-1'),
  })

const detailOf = (outcome: ToolOutcome): ToolSpanDetail | undefined =>
  'spanDetail' in outcome ? outcome.spanDetail : undefined

describe('the span detail a bash call reports', () => {
  it('is ok with the zero a command exited with, and how long it took', async () => {
    const detail = detailOf(await run({ input: { command: 'echo hello' } }))

    expect(detail).toMatchObject({
      'exec.outcome': 'ok',
      'exec.exitCode': 0,
      'exec.program': 'echo',
    })
    expect(typeof detail?.['exec.durationMs']).toBe('number')
  }, 30_000)

  it('is exit with the code a command gave, never the command itself', async () => {
    const detail = detailOf(await run({ input: { command: 'echo partial; exit 2' } }))

    expect(detail).toMatchObject({
      'exec.outcome': 'exit',
      'exec.exitCode': 2,
      'exec.program': 'echo',
    })
    expect(JSON.stringify(detail)).not.toContain('partial')
  }, 30_000)

  it('is absent for a call a refusal stopped before anything ran', async () => {
    const outcome = await run({ input: { command: 'pwd', workdir: '/nowhere-at-all' } })

    expect(outcome).toMatchObject({ ok: false })
    expect(detailOf(outcome)).toBeUndefined()
  }, 30_000)

  it('is oom, with the code a killed command leaves behind', async () => {
    const detail = detailOf(
      await run({ processes: new OomPort(), input: { command: 'python balloon.py' } }),
    )

    expect(detail).toMatchObject({ 'exec.outcome': 'oom', 'exec.exitCode': 137 })
    expect(detail?.['exec.program']).toBe('python')
  }, 30_000)

  it('is timeout for a command killed at its wait window, with no exit code to blame', async () => {
    const port = new HandoverPort({ adopt: false })

    const detail = detailOf(
      await run({ processes: port, input: { command: 'sleep 30', timeoutMs: 50 } }),
    )

    expect(detail).toMatchObject({ 'exec.outcome': 'timeout', 'exec.program': 'sleep' })
    expect(detail?.['exec.exitCode']).toBeUndefined()
  }, 30_000)

  it('is timeout for a command handed to the background when its wait window closed', async () => {
    const port = new HandoverPort({ adopt: true })

    const detail = detailOf(
      await run({ processes: port, input: { command: 'sleep 30', timeoutMs: 50 } }),
    )

    expect(detail).toMatchObject({ 'exec.outcome': 'timeout', 'exec.program': 'sleep' })
  }, 30_000)

  it('is cancelled for a command the operator interrupted', async () => {
    const controller = new AbortController()
    const outcome = run({
      input: { command: 'sleep 30' },
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 100)

    expect(detailOf(await outcome)).toMatchObject({
      'exec.outcome': 'cancelled',
      'exec.program': 'sleep',
    })
  }, 15_000)

  it('is backgrounded for a shell a call started in the background', async () => {
    const detail = detailOf(await run({ input: { command: 'bun run build', background: true } }))

    expect(detail).toMatchObject({ 'exec.outcome': 'backgrounded', 'exec.program': 'bun run' })
  }, 30_000)
})
