import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ETranscriptPart, MAX_PENDING_AUDIO_BYTES } from '../gateway-protocol'
import {
  openTranscription,
  TRANSCRIPTION_PREMATURE_CLOSE_MESSAGE,
  TRANSCRIPTION_UNREACHABLE_MESSAGE,
} from '../transcription-connection'

class FakeSocket {
  static opened: FakeSocket[] = []
  binaryType = ''
  sent: unknown[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor() {
    FakeSocket.opened.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
  }

  deliver(part: unknown) {
    this.onmessage?.({ data: JSON.stringify(part) })
  }

  drop() {
    this.onclose?.()
  }
}

const realWebSocket = globalThis.WebSocket

const socketOf = (): FakeSocket => {
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('the socket never opened')
  return socket
}

const collectorOf = () => {
  const parts: string[] = []
  const errors: string[] = []
  const done: number[] = []
  return {
    parts,
    errors,
    done,
    handlers: {
      onPart: (part: { type: string }) => {
        parts.push(part.type)
      },
      onError: (message: string) => {
        errors.push(message)
      },
      onDone: () => {
        done.push(1)
      },
    },
  }
}

const openOf = () => {
  const collector = collectorOf()
  const connection = openTranscription({
    url: 'wss://gateway.test/transcription-model',
    token: 'vcst_abc',
    handlers: collector.handlers,
  })
  return { ...collector, connection, socket: socketOf() }
}

const bytesOf = (size: number): Uint8Array => new Uint8Array(size).fill(7)

describe('openTranscription', () => {
  beforeEach(() => {
    FakeSocket.opened = []
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = realWebSocket
  })

  it('sends the start frame first, then the audio captured before the socket opened', () => {
    const collector = collectorOf()
    const connection = openTranscription({
      url: 'wss://gateway.test/x',
      token: 'vcst_abc',
      handlers: collector.handlers,
    })
    const socket = socketOf()
    const first = bytesOf(4)
    const second = bytesOf(8)
    connection.sendAudio(first)
    connection.sendAudio(second)
    expect(socket.sent).toEqual([])

    socket.onopen?.()

    expect(socket.sent[0]).toContain('transcription-stream.start')
    expect(socket.sent.slice(1)).toEqual([first, second])
    connection.close()
  })

  it('drops the oldest audio once the pending buffer is full', () => {
    const collector = collectorOf()
    const connection = openTranscription({
      url: 'wss://gateway.test/x',
      token: 'vcst_abc',
      handlers: collector.handlers,
    })
    const socket = socketOf()
    const half = MAX_PENDING_AUDIO_BYTES / 2
    connection.sendAudio(bytesOf(half))
    connection.sendAudio(bytesOf(half))
    connection.sendAudio(bytesOf(half))

    socket.onopen?.()

    expect(socket.sent).toHaveLength(3)
    expect((socket.sent[1] as Uint8Array).byteLength).toBe(half)
    expect((socket.sent[2] as Uint8Array).byteLength).toBe(half)
    connection.close()
  })

  it('finishes once the socket opens when the audio ended before it', () => {
    const collector = collectorOf()
    const connection = openTranscription({
      url: 'wss://gateway.test/x',
      token: 'vcst_abc',
      handlers: collector.handlers,
    })
    connection.finish()
    socketOf().onopen?.()

    expect(socketOf().sent.at(-1)).toContain('transcription-stream.audio-done')
    connection.close()
  })

  it('reports a close before the finish part as an error, keeping the parts it heard', () => {
    const collector = openOf()
    collector.socket.onopen?.()
    collector.socket.deliver({ type: ETranscriptPart.Partial, text: 'Ask not' })

    collector.socket.drop()

    expect(collector.parts).toEqual([ETranscriptPart.Partial])
    expect(collector.errors).toEqual([TRANSCRIPTION_PREMATURE_CLOSE_MESSAGE])
    expect(collector.done).toHaveLength(0)
  })

  it('reports a close after the finish part as a normal end', () => {
    const collector = openOf()
    collector.socket.onopen?.()
    collector.socket.deliver({ type: ETranscriptPart.Finish, text: 'Ask not' })

    collector.socket.drop()

    expect(collector.parts).toEqual([ETranscriptPart.Finish])
    expect(collector.errors).toEqual([])
    expect(collector.done).toHaveLength(1)
  })

  it('reports a socket error once', () => {
    const collector = openOf()
    collector.socket.onerror?.()
    collector.socket.drop()

    expect(collector.errors).toEqual([TRANSCRIPTION_UNREACHABLE_MESSAGE])
  })

  it('sends nothing when the socket opens after the connection was closed', () => {
    const collector = openOf()
    collector.connection.sendAudio(bytesOf(4))
    collector.connection.close()

    collector.socket.onopen?.()

    expect(collector.socket.sent).toEqual([])
  })

  it('says nothing once it was closed on purpose', () => {
    const collector = openOf()
    collector.socket.onopen?.()
    collector.connection.close()

    collector.socket.drop()

    expect(collector.errors).toEqual([])
    expect(collector.done).toHaveLength(0)
  })
})
