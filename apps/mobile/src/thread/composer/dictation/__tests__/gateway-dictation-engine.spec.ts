import { beforeEach, describe, expect, it, mock } from 'bun:test'

import {
  EDictationEvent,
  MICROPHONE_DENIED_MESSAGE,
  type TDictationEvent,
} from '../dictation-engine'
import type { ITranscriptionConnection, ITranscriptionHandlers } from '../transcription-connection'

const audio = {
  granted: true,
  permissionError: null as unknown,
  recordingError: null as unknown,
  playbackError: null as unknown,
  modes: [] as string[],
}

mock.module('expo-audio', () => ({
  requestRecordingPermissionsAsync: async () => {
    if (audio.permissionError !== null) throw audio.permissionError
    return { granted: audio.granted }
  },
  setAudioModeAsync: async (mode: { allowsRecording?: boolean }) => {
    const recording = mode.allowsRecording === true
    audio.modes.push(recording ? 'recording' : 'playback')
    if (recording && audio.recordingError !== null) throw audio.recordingError
    if (!recording && audio.playbackError !== null) throw audio.playbackError
  },
}))

const { GatewayDictationEngine } = await import('../gateway-dictation-engine')

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
    fail: (message: string) => {
      if (handlers === undefined) throw new Error('the connection never opened')
      handlers.onError(message)
    },
  }
}

const bufferOf = (sample: number) => ({
  data: Int16Array.from([sample, sample, sample, sample]).buffer,
  sampleRate: 16000,
  channels: 1,
})

const engineOf = ({
  stream,
  requestToken,
  open,
}: {
  stream: ReturnType<typeof streamOf>['stream']
  requestToken: () => Promise<{ token: string; url: string }>
  open: ReturnType<typeof connectionOf>['open']
}) =>
  new GatewayDictationEngine({
    stream,
    requestToken,
    open,
  })

const collect = () => {
  const events: TDictationEvent[] = []
  return { events, onEvent: (event: TDictationEvent) => events.push(event) }
}

const tokenOf = async () => ({ token: 'vcst_abc', url: 'wss://gateway.test/x' })

describe('GatewayDictationEngine', () => {
  beforeEach(() => {
    audio.granted = true
    audio.permissionError = null
    audio.recordingError = null
    audio.playbackError = null
    audio.modes = []
  })

  it('reports a refused microphone without asking for a token', async () => {
    const { events, onEvent } = collect()
    const { stream, calls } = streamOf()
    const connection = connectionOf()
    let tokens = 0
    audio.granted = false

    const session = await engineOf({
      stream,
      requestToken: async () => {
        tokens += 1
        return tokenOf()
      },
      open: connection.open,
    }).start({ onEvent })

    expect(events).toEqual([{ type: EDictationEvent.Error, message: MICROPHONE_DENIED_MESSAGE }])
    expect(tokens).toBe(0)
    expect(calls.stopped).toBe(0)
    await session.stop()
  })

  it('reports a permission request that rejects without rejecting the start', async () => {
    const { events, onEvent } = collect()
    const { stream, calls } = streamOf()
    const connection = connectionOf()
    audio.permissionError = new Error('permission plumbing died')

    const session = await engineOf({ stream, requestToken: tokenOf, open: connection.open }).start({
      onEvent,
    })

    expect(events).toEqual([{ type: EDictationEvent.Error, message: 'permission plumbing died' }])
    expect(audio.modes).toEqual(['playback'])
    expect(calls.stopped).toBe(1)
    await session.stop()
  })

  it('restores the playback mode and reports the failure when the recording mode cannot be set', async () => {
    const { events, onEvent } = collect()
    const { stream, calls } = streamOf()
    const connection = connectionOf()
    audio.recordingError = new Error('the audio session is busy')

    await engineOf({ stream, requestToken: tokenOf, open: connection.open }).start({ onEvent })

    expect(events).toEqual([{ type: EDictationEvent.Error, message: 'the audio session is busy' }])
    expect(audio.modes).toEqual(['recording', 'playback'])
    expect(calls.stopped).toBe(1)
  })

  it('never rejects the start when the playback mode cannot be restored', async () => {
    const { events, onEvent } = collect()
    const { stream } = streamOf()
    const connection = connectionOf()
    audio.recordingError = new Error('the audio session is busy')
    audio.playbackError = new Error('no audio session')

    const session = await engineOf({
      stream,
      requestToken: tokenOf,
      open: connection.open,
    }).start({ onEvent })

    expect(events).toEqual([{ type: EDictationEvent.Error, message: 'the audio session is busy' }])
    await session.stop()
  })

  it('streams the audio captured while the token was minted', async () => {
    const { onEvent } = collect()
    const { stream } = streamOf()
    const connection = connectionOf()
    let mintToken: () => void = () => undefined
    const minting = new Promise<void>((resolve) => {
      mintToken = resolve
    })
    const engine = engineOf({
      stream,
      requestToken: async () => {
        await minting
        return tokenOf()
      },
      open: connection.open,
    })

    const started = engine.start({ onEvent })
    engine.handleBuffer(bufferOf(16384))
    mintToken()
    const session = await started

    expect(connection.calls.audio).toBe(1)
    session.cancel()
  })

  it('stops the microphone and restores the playback mode when the speech service fails', async () => {
    const { events, onEvent } = collect()
    const { stream, calls } = streamOf()
    const connection = connectionOf()
    const session = await engineOf({
      stream,
      requestToken: tokenOf,
      open: connection.open,
    }).start({ onEvent })

    connection.fail('Dictation stopped before the speech service sent the text.')

    expect(events).toEqual([
      {
        type: EDictationEvent.Error,
        message: 'Dictation stopped before the speech service sent the text.',
      },
    ])
    expect(calls.stopped).toBe(1)
    expect(connection.calls.closed).toBe(1)
    expect(audio.modes).toEqual(['recording', 'playback'])
    await session.stop()
    expect(audio.modes).toEqual(['recording', 'playback'])
  })
})
