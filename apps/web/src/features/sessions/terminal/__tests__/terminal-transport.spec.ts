import { describe, expect, it } from 'bun:test'

import type { TerminalStreamAttachInput } from '@dltech/atlas-protocol'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import { ETerminalOp, type TerminalProblem } from '../terminal-model'
import {
  createTerminalTransport,
  type TerminalApi,
  type TerminalStreamHandlers,
} from '../terminal-transport'

const encoded = (text: string): string => btoa(text)

type Failures = { open?: Error; write?: Error; resize?: Error }

type Harness = {
  transport: ReturnType<typeof createTerminalTransport>
  send: (frame: unknown) => void
  fail: (failure: unknown) => void
  attach: () => TerminalStreamAttachInput | undefined
  readOffsets: number[]
  unsubscribed: () => number
  outputs: { terminalId: string; offset: number; text: string }[]
  links: ETerminalConnection[]
  problems: (TerminalProblem | undefined)[]
  writes: string[]
}

function harness(
  options: { read?: { offset: number; data: string; totalBytes: number } } & Failures = {},
) {
  const readOffsets: number[] = []
  const outputs: Harness['outputs'] = []
  const links: ETerminalConnection[] = []
  const problems: (TerminalProblem | undefined)[] = []
  const writes: string[] = []
  let attachInput: TerminalStreamAttachInput | undefined
  let handlers: TerminalStreamHandlers | undefined
  let closed = 0
  const failures = { open: options.open, write: options.write, resize: options.resize }
  const take = (key: keyof Failures): Error | undefined => {
    const failure = failures[key]
    failures[key] = undefined
    return failure
  }
  const failOnce = (failure: Error | undefined): void => {
    if (failure !== undefined) throw failure
  }

  const api: TerminalApi = {
    list: async () => ({ terminals: [] }),
    open: async () => {
      failOnce(take('open'))
      return { state: 'open', terminalId: 't1', pid: 1 }
    },
    rename: async () => ({ state: 'done' }),
    write: async (input) => {
      failOnce(take('write'))
      writes.push(input.data)
      return { state: 'done' }
    },
    resize: async () => {
      failOnce(take('resize'))
      return { state: 'done' }
    },
    close: async () => ({ state: 'done' }),
    read: async (input) => {
      readOffsets.push(input.offset)
      const result = options.read ?? { offset: input.offset, data: '', totalBytes: input.offset }
      return { ...result, data: encoded(result.data), exited: null }
    },
  }

  const transport = createTerminalTransport({
    sessionId: 'ses-1',
    api,
    subscribe: (input, listen) => {
      attachInput = input
      handlers = listen
      return { unsubscribe: () => (closed += 1) }
    },
    onOutput: (frame) =>
      outputs.push({
        terminalId: frame.terminalId,
        offset: frame.offset,
        text: Buffer.from(frame.data).toString('utf8'),
      }),
    onExit: () => undefined,
    onClosed: () => undefined,
    onLink: (state) => links.push(state),
    onProblem: (problem) => problems.push(problem),
  })

  transport.reconnect([{ terminalId: 't1', offset: 0 }])

  return {
    transport,
    send: (frame: unknown) => handlers?.onData(frame),
    fail: (failure: unknown) => handlers?.onError(failure),
    attach: () => attachInput,
    readOffsets,
    unsubscribed: () => closed,
    outputs,
    links,
    problems,
    writes,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('terminal transport', () => {
  it('attaches with the cursors it was given', () => {
    const test = harness()
    expect(test.attach()).toEqual({
      sessionId: 'ses-1',
      cursors: [{ terminalId: 't1', offset: 0 }],
    })
  })

  it('treats a parked frame as a dropped stream so the retry loop takes over', () => {
    const test = harness()
    test.send({ type: 'parked' })
    expect(test.unsubscribed()).toBe(1)
    expect(test.links.at(-1)).toBe(ETerminalConnection.Paused)
    expect(test.problems.at(-1)).toEqual({
      op: ETerminalOp.Stream,
      message: "couldn't reach the session — retrying",
    })
  })

  it('pauses and reports an attach failure with the server message', () => {
    const test = harness()
    test.fail(new Error('no host picked this session up in time — retry the stream'))
    expect(test.links.at(-1)).toBe(ETerminalConnection.Paused)
    expect(test.problems.at(-1)).toEqual({
      op: ETerminalOp.Stream,
      message: 'no host picked this session up in time — retry the stream',
    })
  })

  it('clears the problem once a stream is ready', () => {
    const test = harness()
    test.fail(new Error('no host picked this session up in time — retry the stream'))
    test.send({ type: 'ready', sessionId: 'ses-1' })
    expect(test.problems.at(-1)).toBeUndefined()
    expect(test.links.at(-1)).toBe(ETerminalConnection.Connected)
  })

  it('reports a failed write, keeps the queue moving, and clears on the next one', async () => {
    const test = harness({ write: new Error('pod is asleep') })
    test.transport.write('t1', 'ls\n')
    await tick()
    expect(test.problems.at(-1)).toEqual({ op: ETerminalOp.Write, message: 'pod is asleep' })

    test.transport.write('t1', 'pwd\n')
    await tick()
    expect(test.problems.at(-1)).toBeUndefined()
    expect(test.writes).toEqual(['pwd\n'])
  })

  it('falls back to its own wording when a failure carries no message', async () => {
    const test = harness({ resize: new Error() })
    test.transport.resize('t1', 80, 24)
    await tick()
    expect(test.problems.at(-1)).toEqual({
      op: ETerminalOp.Resize,
      message: "couldn't reach the session — retrying",
    })
  })

  it('reports a failed open and rejects it to the caller', async () => {
    const test = harness({ open: new Error('pod is asleep') })
    const opening = test.transport.open({ cols: 80, rows: 24 })
    await expect(opening).rejects.toThrow('pod is asleep')
    expect(test.problems.at(-1)).toEqual({ op: ETerminalOp.Open, message: 'pod is asleep' })
  })

  it('routes output frames to their own terminal and advances by decoded bytes', async () => {
    const test = harness()
    test.send({ type: 'ready', sessionId: 'ses-1' })
    test.send({ type: 'output', terminalId: 't1', offset: 0, data: encoded('hi') })
    test.send({ type: 'output', terminalId: 't2', offset: 0, data: encoded('yo') })
    expect(test.outputs).toEqual([
      { terminalId: 't1', offset: 0, text: 'hi' },
      { terminalId: 't2', offset: 0, text: 'yo' },
    ])
    expect(test.links).toEqual([ETerminalConnection.Connecting, ETerminalConnection.Connected])

    test.send({ type: 'gap', terminalId: 't1', offset: 9 })
    await tick()
    expect(test.readOffsets).toEqual([2])
  })

  it('reads from the cursor it has rendered when a gap drops bytes', async () => {
    const test = harness({
      read: { offset: 4, data: 'missed', totalBytes: 10 },
    })
    test.send({ type: 'output', terminalId: 't1', offset: 0, data: encoded('hi') })
    test.send({ type: 'gap', terminalId: 't1', offset: 4 })
    await tick()
    expect(test.readOffsets).toEqual([2])
    expect(test.outputs.at(-1)).toEqual({ terminalId: 't1', offset: 4, text: 'missed' })
  })

  it('stops delivering frames once disposed', () => {
    const test = harness()
    test.transport.dispose()
    test.send({ type: 'output', terminalId: 't1', offset: 0, data: encoded('hi') })
    expect(test.outputs).toEqual([])
  })
})
