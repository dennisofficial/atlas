import { describe, expect, it } from 'bun:test'

import type { TerminalStreamAttachInput } from '@dltech/atlas-protocol'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import {
  createTerminalTransport,
  type TerminalApi,
  type TerminalStreamHandlers,
} from '../terminal-transport'

const encoded = (text: string): string => btoa(text)

type Harness = {
  transport: ReturnType<typeof createTerminalTransport>
  send: (frame: unknown) => void
  attach: () => TerminalStreamAttachInput | undefined
  readOffsets: number[]
  unsubscribed: () => number
  outputs: { terminalId: string; offset: number; text: string }[]
  links: ETerminalConnection[]
}

function harness(options: { read?: { offset: number; data: string; totalBytes: number } } = {}) {
  const readOffsets: number[] = []
  const outputs: Harness['outputs'] = []
  const links: ETerminalConnection[] = []
  let attachInput: TerminalStreamAttachInput | undefined
  let handlers: TerminalStreamHandlers | undefined
  let closed = 0

  const api: TerminalApi = {
    list: async () => ({ terminals: [] }),
    open: async () => ({ state: 'parked' }),
    rename: async () => ({ state: 'done' }),
    write: async () => ({ state: 'done' }),
    resize: async () => ({ state: 'done' }),
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
  })

  transport.reconnect([{ terminalId: 't1', offset: 0 }])

  return {
    transport,
    send: (frame: unknown) => handlers?.onData(frame),
    attach: () => attachInput,
    readOffsets,
    unsubscribed: () => closed,
    outputs,
    links,
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

  it('closes the subscription and reports disconnected when parked', () => {
    const test = harness()
    test.send({ type: 'parked' })
    expect(test.unsubscribed()).toBe(1)
    expect(test.links.at(-1)).toBe(ETerminalConnection.Disconnected)
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
