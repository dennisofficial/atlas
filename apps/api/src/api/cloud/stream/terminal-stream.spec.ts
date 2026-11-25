import { describe, expect, it, vi } from 'bun:test'
import { ServiceUnavailableException } from '@nestjs/common'
import type { EventFrame, PodFollowClose } from '@dltech/atlas-host'
import {
  TERMINAL_STREAM_BUFFER_BYTES,
  type TerminalReadOutput,
  type TerminalStreamFrame,
} from '@dltech/atlas-protocol'
import type { PodOps, TerminalDemand } from '../../../agent'
import { PodNotReadyError } from '../../platform/sessions/pod-errors'
import type { TerminalService } from '../../platform/sessions/terminal.service'
import type { DrainStateService } from '../../platform/health/drain-state.service'
import { TerminalStreamQueue } from './terminal-stream-queue'
import { TerminalStreamService } from './terminal-stream.service'

const output = (args: { terminalId?: string; offset: number; data: string }): EventFrame => ({
  kind: 'event',
  event: {
    type: 'terminal.output',
    terminalId: args.terminalId ?? 't1',
    offset: args.offset,
    data: args.data,
  },
})

const exited = (args: { terminalId?: string; exitCode: number | null }): EventFrame => ({
  kind: 'event',
  event: {
    type: 'terminal.exit',
    terminalId: args.terminalId ?? 't1',
    exitCode: args.exitCode,
    signal: null,
  },
})

const pageOf = (over: Partial<TerminalReadOutput> = {}): TerminalReadOutput => ({
  offset: 0,
  data: '',
  totalBytes: 0,
  exited: null,
  ...over,
})

const terminalsOf = () => ({
  requireOwned: vi.fn(async () => undefined),
  read: vi.fn(async (_args: { offset: number }): Promise<TerminalReadOutput> => pageOf()),
  recordExit: vi.fn(async () => undefined),
})

const operationsOf = (held: boolean) => {
  const state: {
    listener: ((frame: EventFrame) => void) | undefined
    close: ((reason: PodFollowClose) => void) | undefined
    dispose: ReturnType<typeof vi.fn>
  } = { listener: undefined, close: undefined, dispose: vi.fn() }
  const follow = vi.fn(
    async (args: {
      sessionId: string
      listener: (frame: EventFrame) => void
      onClose?: ((reason: PodFollowClose) => void) | undefined
    }) => {
      if (!held) return null
      state.listener = args.listener
      state.close = args.onClose
      return state.dispose
    },
  )
  const ops = {
    invoke: vi.fn(),
    follow,
    events: vi.fn(() => null),
    hold: vi.fn(() => true),
    servesLocally: vi.fn(async () => held),
  }
  return { ops: ops as unknown as PodOps, state, follow }
}

const drainOf = () => {
  const state = { draining: false }
  const drain = { isDraining: () => state.draining } as unknown as DrainStateService
  return { drain, state }
}

const serviceOf = (args: {
  terminals: ReturnType<typeof terminalsOf>
  ops: PodOps
  drain?: DrainStateService
  demand?: TerminalDemand
}) =>
  new TerminalStreamService(
    args.terminals as unknown as TerminalService,
    args.drain ?? drainOf().drain,
    args.ops,
    args.demand ?? null,
  )

const collect = (generator: AsyncGenerator<TerminalStreamFrame>) => {
  const frames: TerminalStreamFrame[] = []
  const done = (async () => {
    for await (const frame of generator) frames.push(frame)
  })()
  return { frames, done }
}

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('timed out')
}

const attach = (service: TerminalStreamService, signal?: AbortSignal) =>
  service.attach({
    userId: 'u1',
    sessionId: 's1',
    cursors: [{ terminalId: 't1', offset: 0 }],
    ...(signal === undefined ? {} : { signal }),
  })

describe('TerminalStreamService', () => {
  it('asks for a holder and refuses the stream when none arrives', async () => {
    const terminals = terminalsOf()
    const { ops, state, follow } = operationsOf(false)
    const run = collect(attach(serviceOf({ terminals, ops })))
    const failure = await run.done.catch((error: unknown) => error)
    expect(run.frames).toEqual([{ type: 'ready', sessionId: 's1' }])
    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect(follow).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }))
    expect(state.listener).toBeUndefined()
    expect(terminals.read).not.toHaveBeenCalled()
  })

  it('holds the terminal demand for as long as the stream is attached', async () => {
    const terminals = terminalsOf()
    const { ops } = operationsOf(true)
    const release = vi.fn()
    const demand = { hold: vi.fn(() => release) } as unknown as TerminalDemand
    const abort = new AbortController()
    const run = collect(attach(serviceOf({ terminals, ops, demand }), abort.signal))
    await until(() => run.frames.length >= 1)
    expect(demand.hold).toHaveBeenCalledWith('s1')
    expect(release).not.toHaveBeenCalled()
    abort.abort()
    await run.done
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('replays a cursor as output then exit', async () => {
    const terminals = terminalsOf()
    terminals.read.mockResolvedValueOnce(
      pageOf({ offset: 0, data: 'aGk=', totalBytes: 2, exited: { exitCode: 0, signal: null } }),
    )
    const { ops } = operationsOf(true)
    const run = collect(attach(serviceOf({ terminals, ops })))
    await until(() => run.frames.length >= 3)
    expect(terminals.read).toHaveBeenCalledWith({
      userId: 'u1',
      sessionId: 's1',
      terminalId: 't1',
      offset: 0,
    })
    expect(run.frames.slice(0, 3)).toEqual([
      { type: 'ready', sessionId: 's1' },
      { type: 'output', terminalId: 't1', offset: 0, data: 'aGk=' },
      { type: 'exit', terminalId: 't1', exitCode: 0, signal: null },
    ])
  })

  it('closes asleep only when the pod is parked during replay', async () => {
    const terminals = terminalsOf()
    terminals.read.mockRejectedValueOnce(new PodNotReadyError())
    const { ops } = operationsOf(true)
    const run = collect(attach(serviceOf({ terminals, ops })))
    await run.done
    expect(run.frames).toEqual([
      { type: 'ready', sessionId: 's1' },
      { type: 'closed', reason: 'asleep' },
    ])
  })

  it('closes detached for a dropped replay so the client reconnects', async () => {
    const terminals = terminalsOf()
    terminals.read.mockRejectedValueOnce(new Error('undici: connection reset'))
    const { ops } = operationsOf(true)
    const run = collect(attach(serviceOf({ terminals, ops })))
    await run.done
    expect(run.frames).toEqual([
      { type: 'ready', sessionId: 's1' },
      { type: 'closed', reason: 'detached' },
    ])
  })

  it('forwards live output and writes the row when the shell exits', async () => {
    const terminals = terminalsOf()
    const { ops, state } = operationsOf(true)
    const run = collect(attach(serviceOf({ terminals, ops })))
    await until(() => run.frames.length >= 1)
    state.listener?.(output({ offset: 2, data: 'aGk=' }))
    await until(() => run.frames.length >= 2)
    state.listener?.(exited({ exitCode: 3 }))
    await until(() => run.frames.length >= 3)
    expect(run.frames[1]).toEqual({
      type: 'output',
      terminalId: 't1',
      offset: 2,
      data: 'aGk=',
    })
    expect(run.frames[2]).toEqual({
      type: 'exit',
      terminalId: 't1',
      exitCode: 3,
      signal: null,
    })
    expect(terminals.recordExit).toHaveBeenCalledWith({
      sessionId: 's1',
      terminalId: 't1',
      exitCode: 3,
      signal: null,
    })
  })

  it('drops live output the replay already delivered', async () => {
    const terminals = terminalsOf()
    terminals.read.mockResolvedValueOnce(pageOf({ offset: 0, data: 'aGk=', totalBytes: 2 }))
    const { ops, state } = operationsOf(true)
    const run = collect(attach(serviceOf({ terminals, ops })))
    await until(() => run.frames.length >= 2)
    state.listener?.(output({ offset: 0, data: 'aGk=' }))
    state.listener?.(output({ offset: 2, data: 'IQ==' }))
    await until(() => run.frames.length >= 3)
    expect(run.frames.slice(1)).toEqual([
      { type: 'output', terminalId: 't1', offset: 0, data: 'aGk=' },
      { type: 'output', terminalId: 't1', offset: 2, data: 'IQ==' },
    ])
  })

  it('closes with asleep, detached and restarted', async () => {
    for (const testCase of [
      { draining: false, close: 'asleep' as const, reason: 'asleep' as const },
      { draining: false, close: 'detached' as const, reason: 'detached' as const },
      { draining: true, close: 'asleep' as const, reason: 'restarted' as const },
    ]) {
      const terminals = terminalsOf()
      const { ops, state } = operationsOf(true)
      const drain = drainOf()
      const run = collect(attach(serviceOf({ terminals, ops, drain: drain.drain })))
      await until(() => run.frames.length >= 1)
      drain.state.draining = testCase.draining
      state.close?.(testCase.close)
      await run.done
      expect(run.frames.at(-1)).toEqual({ type: 'closed', reason: testCase.reason })
    }
  })

  it('aborting ends the stream and disposes the listener', async () => {
    const terminals = terminalsOf()
    const { ops, state } = operationsOf(true)
    const abort = new AbortController()
    const run = collect(attach(serviceOf({ terminals, ops }), abort.signal))
    await until(() => run.frames.length >= 1)
    abort.abort()
    await run.done
    expect(run.frames).toEqual([{ type: 'ready', sessionId: 's1' }])
    expect(state.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalStreamQueue', () => {
  it('drops one terminal’s queued frames and yields a single gap at the oldest offset', async () => {
    const queue = new TerminalStreamQueue(TERMINAL_STREAM_BUFFER_BYTES)
    const chunk = 'a'.repeat(TERMINAL_STREAM_BUFFER_BYTES / 2 + 1)
    queue.push({ type: 'output', terminalId: 't1', offset: 0, data: chunk })
    queue.push({ type: 'ready', sessionId: 's1' })
    queue.push({ type: 'output', terminalId: 't1', offset: chunk.length, data: chunk })
    queue.end()
    const frames: TerminalStreamFrame[] = []
    for (let frame = await queue.next(); frame !== undefined; frame = await queue.next())
      frames.push(frame)
    expect(frames).toEqual([
      { type: 'ready', sessionId: 's1' },
      { type: 'gap', terminalId: 't1', offset: 0 },
      {
        type: 'output',
        terminalId: 't1',
        offset: chunk.length,
        data: chunk,
      },
    ])
  })
})
