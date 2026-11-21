import { describe, expect, it, vi } from 'bun:test'
import {
  PodCalls,
  type EventFrame,
  type RemoteCloseReason,
  type SessionRuntime,
} from '@dltech/atlas-host'
import {
  TERMINAL_STREAM_BUFFER_BYTES,
  type TerminalReadOutput,
  type TerminalStreamFrame,
} from '@dltech/atlas-protocol'
import type { PodOps, TerminalDemand } from '../../../agent'
import type { TerminalService } from '../../platform/control/terminal.service'
import type { DrainStateService } from '../../platform/health/drain-state.service'
import { TerminalStreamQueue } from './terminal-stream-queue'
import { TerminalStreamService } from './terminal-stream.service'

const outputFrame = (args: { terminalId: string; offset: number; data: string }): EventFrame => ({
  kind: 'event',
  event: {
    type: 'terminal.output',
    terminalId: args.terminalId,
    offset: args.offset,
    data: args.data,
  },
})

const hostOf = () => {
  const listeners = new Set<(frame: EventFrame) => void>()
  const closes = new Set<(reason: RemoteCloseReason) => void>()
  const runtime = {
    remoteCalls: {
      onEvent: (listener: (frame: EventFrame) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      onClose: (listener: (reason: RemoteCloseReason) => void) => {
        closes.add(listener)
        return () => {
          closes.delete(listener)
        }
      },
    },
  }
  const calls = new PodCalls({
    held: () => runtime as unknown as SessionRuntime,
  })
  return {
    ops: calls as unknown as PodOps,
    listeners,
    closes,
    emit: (frame: EventFrame) => {
      for (const listener of [...listeners]) listener(frame)
    },
  }
}

const terminalsOf = (): TerminalService =>
  ({
    requireOwned: async () => undefined,
    read: async (): Promise<TerminalReadOutput> => ({
      offset: 0,
      data: '',
      totalBytes: 0,
      exited: null,
    }),
    recordExit: async () => undefined,
  }) as unknown as TerminalService

const drainOf = (): DrainStateService =>
  ({ isDraining: () => false }) as unknown as DrainStateService

const serviceOf = (args: {
  ops: PodOps
  demand?: TerminalDemand | null
  lifetimeMs?: number | undefined
}): TerminalStreamService =>
  new TerminalStreamService(
    terminalsOf(),
    drainOf(),
    args.ops,
    args.demand ?? null,
    args.lifetimeMs,
  )

const attach = (service: TerminalStreamService, signal?: AbortSignal) =>
  service.attach({
    userId: 'u1',
    sessionId: 's1',
    cursors: [],
    ...(signal === undefined ? {} : { signal }),
  })

const settled = async <T>(work: Promise<T>): Promise<T | undefined> =>
  Promise.race([work, Bun.sleep(200).then(() => undefined)])

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return
    await Bun.sleep(1)
  }
  throw new Error('timed out')
}

describe('TerminalStreamService retention', () => {
  it('releases the host listener of a stream the client abandoned mid-flight', async () => {
    const host = hostOf()
    const service = serviceOf({ ops: host.ops })
    for (let index = 0; index < 25; index += 1) {
      const abort = new AbortController()
      const stream = attach(service, abort.signal)
      await stream.next()
      const pending = stream.next()
      const before = host.listeners.size
      await until(() => host.listeners.size === before + 1)
      host.emit(outputFrame({ terminalId: 't1', offset: index * 2, data: 'aGk=' }))
      await pending
      abort.abort()
    }
    expect(host.listeners.size).toBe(0)
    expect(host.closes.size).toBe(0)
  })

  it('misses no abort that lands while the holder is being awaited', async () => {
    const host = hostOf()
    const ops: PodOps = {
      invoke: (input) => host.ops.invoke(input),
      events: (input) => host.ops.events(input),
      hold: () => true,
      waitForHolder: async () => {
        await Bun.sleep(20)
        return true
      },
    }
    const abort = new AbortController()
    const stream = attach(serviceOf({ ops }), abort.signal)
    await stream.next()
    const pending = stream.next()
    abort.abort()
    await Bun.sleep(60)
    expect(host.listeners.size).toBe(0)
    expect(host.closes.size).toBe(0)
    void settled(pending)
  })

  it('ends an abandoned stream at its lifetime and frees its demand hold', async () => {
    const host = hostOf()
    const release = vi.fn()
    const demand = { hold: vi.fn(() => release) } as unknown as TerminalDemand
    const stream = attach(serviceOf({ ops: host.ops, demand, lifetimeMs: 20 }))
    await stream.next()
    const frame = await settled(stream.next())
    expect(frame).toEqual({ done: false, value: { type: 'closed', reason: 'detached' } })
    expect(host.listeners.size).toBe(0)
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalStreamQueue byte bound', () => {
  it('bounds buffered output across two terminals', async () => {
    const queue = new TerminalStreamQueue(TERMINAL_STREAM_BUFFER_BYTES)
    const chunk = 'a'.repeat(TERMINAL_STREAM_BUFFER_BYTES - 1024)
    for (const terminalId of ['t1', 't2']) {
      queue.push({ type: 'output', terminalId, offset: 0, data: chunk })
      queue.push({ type: 'output', terminalId, offset: chunk.length, data: chunk })
    }
    queue.end()
    const frames: TerminalStreamFrame[] = []
    for (let frame = await queue.next(); frame !== undefined; frame = await queue.next())
      frames.push(frame)
    const bytes = frames.reduce(
      (sum, frame) => (frame.type === 'output' ? sum + frame.data.length : sum),
      0,
    )
    expect(bytes).toBeLessThanOrEqual(TERMINAL_STREAM_BUFFER_BYTES)
    expect(frames.some((frame) => frame.type === 'gap')).toBe(true)
  })
})
