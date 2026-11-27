import { describe, expect, it } from 'bun:test'

import { EDictationEvent, type TDictationEvent } from '../dictation-engine'
import { ETranscriptPart, type TTranscriptPart } from '../gateway-protocol'
import { startGatewaySession } from '../gateway-session'
import type { ITranscriptionConnection, ITranscriptionHandlers } from '../transcription-connection'

const collect = () => {
  const events: TDictationEvent[] = []
  return { events, onEvent: (event: TDictationEvent) => events.push(event) }
}

const streamOf = () => {
  const calls = { started: 0, stopped: 0 }
  return {
    calls,
    stream: {
      start: async () => {
        calls.started += 1
      },
      stop: () => {
        calls.stopped += 1
      },
    },
  }
}

const settledOf = () => {
  const calls = { settled: 0 }
  return {
    calls,
    onSettle: () => {
      calls.settled += 1
    },
  }
}

const connectionOf = () => {
  const calls = { audio: 0, finished: 0, closed: 0 }
  let handlers: ITranscriptionHandlers | undefined
  const socket: ITranscriptionConnection = {
    sendAudio: () => {
      calls.audio += 1
    },
    finish: () => {
      calls.finished += 1
    },
    close: () => {
      calls.closed += 1
    },
  }
  return {
    calls,
    socket,
    open: ({
      handlers: next,
    }: {
      url: string
      token: string
      handlers: ITranscriptionHandlers
    }) => {
      handlers = next
      return socket
    },
    handlersOf: (): ITranscriptionHandlers => {
      if (handlers === undefined) throw new Error('the connection never opened')
      return handlers
    },
    send: (part: TTranscriptPart) => {
      if (handlers === undefined) throw new Error('the connection never opened')
      handlers.onPart(part)
    },
    fail: (message: string) => {
      if (handlers === undefined) throw new Error('the connection never opened')
      handlers.onError(message)
    },
    done: () => {
      if (handlers === undefined) throw new Error('the connection never opened')
      handlers.onDone()
    },
  }
}

const bufferOf = (sample: number) => ({
  data: Int16Array.from([sample, sample, sample, sample]).buffer,
  sampleRate: 16000,
  channels: 1,
})

const sessionOf = async () => {
  const { events, onEvent } = collect()
  const { stream, calls: streamCalls } = streamOf()
  const settle = settledOf()
  const connection = connectionOf()
  const session = await startGatewaySession({
    stream,
    requestToken: async () => ({ token: 'vcst_abc', url: 'wss://gateway.test/x' }),
    open: connection.open,
    onEvent,
    onSettle: settle.onSettle,
  })
  return { session, events, streamCalls, settle: settle.calls, connection }
}

describe('startGatewaySession', () => {
  it('opens the microphone and the socket with the minted token', async () => {
    const { events, streamCalls } = await sessionOf()

    expect(streamCalls.started).toBe(1)
    expect(events).toEqual([])
  })

  it('reports the level and streams the audio of every buffer', async () => {
    const { session, events, connection } = await sessionOf()

    session.acceptBuffer(bufferOf(16384))

    expect(connection.calls.audio).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe(EDictationEvent.Level)
  })

  it('shows a partial as interim and commits a final as the whole sentence', async () => {
    const { events, connection } = await sessionOf()

    connection.send({ type: ETranscriptPart.Partial, text: 'Ask not' })
    connection.send({ type: ETranscriptPart.Partial, text: 'Ask not what' })
    connection.send({ type: ETranscriptPart.Final, text: 'Ask not what your country can do' })

    expect(events).toEqual([
      { type: EDictationEvent.Partial, text: 'Ask not' },
      { type: EDictationEvent.Partial, text: 'Ask not what' },
      { type: EDictationEvent.Final, text: 'Ask not what your country can do' },
    ])
  })

  it('ends on the finish part with the whole sentence', async () => {
    const { events, connection } = await sessionOf()

    connection.send({ type: ETranscriptPart.Partial, text: 'Ask not' })
    connection.send({ type: ETranscriptPart.Finish, text: 'Ask not what your country can do' })

    expect(events).toEqual([
      { type: EDictationEvent.Partial, text: 'Ask not' },
      { type: EDictationEvent.Final, text: 'Ask not what your country can do' },
      { type: EDictationEvent.Ended },
    ])
  })

  it('stops the microphone, asks for the final and resolves once it arrives', async () => {
    const { session, events, streamCalls, settle, connection } = await sessionOf()

    const stopped = session.stop()
    expect(streamCalls.stopped).toBe(1)
    expect(connection.calls.finished).toBe(1)

    connection.send({ type: ETranscriptPart.Finish, text: 'Ask not' })
    await stopped

    expect(events.at(-1)).toEqual({ type: EDictationEvent.Ended })
    expect(connection.calls.closed).toBe(1)
    expect(settle.settled).toBe(1)
  })

  it('stops the microphone, closes the socket and restores the audio mode on an error part', async () => {
    const { session, events, streamCalls, settle, connection } = await sessionOf()

    connection.send({ type: ETranscriptPart.Error, message: 'quota' })

    expect(events).toEqual([{ type: EDictationEvent.Error, message: 'quota' }])
    expect(streamCalls.stopped).toBe(1)
    expect(connection.calls.closed).toBe(1)
    expect(settle.settled).toBe(1)
    await session.stop()
    expect(streamCalls.stopped).toBe(1)
    expect(settle.settled).toBe(1)
  })

  it('cleans up when the socket dies before the finish part', async () => {
    const { session, events, streamCalls, settle, connection } = await sessionOf()

    connection.fail('Dictation stopped before the speech service sent the text.')

    expect(events).toEqual([
      {
        type: EDictationEvent.Error,
        message: 'Dictation stopped before the speech service sent the text.',
      },
    ])
    expect(streamCalls.stopped).toBe(1)
    expect(connection.calls.closed).toBe(1)
    expect(settle.settled).toBe(1)
    await session.stop()
    expect(settle.settled).toBe(1)
  })

  it('stops the microphone and restores the audio mode on cancel', async () => {
    const { session, streamCalls, settle, connection } = await sessionOf()

    session.cancel()
    session.cancel()

    expect(streamCalls.stopped).toBe(1)
    expect(connection.calls.closed).toBe(1)
    expect(settle.settled).toBe(1)
  })

  it('sends nothing once the session ended', async () => {
    const { session, connection } = await sessionOf()

    connection.done()
    session.acceptBuffer(bufferOf(16384))

    expect(connection.calls.audio).toBe(0)
  })
})
