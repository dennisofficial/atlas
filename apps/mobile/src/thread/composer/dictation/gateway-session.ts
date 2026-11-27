import { EDictationEvent, type IDictationSession, type TDictationEvent } from './dictation-engine'
import { ETranscriptPart } from './gateway-protocol'
import { EMPTY_SPOKEN, type ISpoken, joinSpoken, withTranscriptPart } from './mai-transcript'
import { audioFramesOf, microphoneChunkOf } from './pcm-int16'
import {
  type ITranscriptionConnection,
  type OpenTranscription,
  openTranscription,
} from './transcription-connection'

export const FINAL_TIMEOUT_MS = 3000

export interface IGatewayAudioBuffer {
  data: ArrayBuffer
  sampleRate: number
  channels: number
}

export interface IDictationAudioStream {
  start: () => Promise<void>
  stop: () => void
}

export type DictationTokenRequest = () => Promise<{ token: string; url: string }>

export interface IGatewaySession extends IDictationSession {
  acceptBuffer: (buffer: IGatewayAudioBuffer) => void
}

export const startGatewaySession = async ({
  stream,
  requestToken,
  open = openTranscription,
  onEvent,
  onSettle = () => undefined,
}: {
  stream: IDictationAudioStream
  requestToken: DictationTokenRequest
  open?: OpenTranscription
  onEvent: (event: TDictationEvent) => void
  onSettle?: () => void | Promise<void>
}): Promise<IGatewaySession> => {
  let spoken: ISpoken = EMPTY_SPOKEN
  let connection: ITranscriptionConnection | undefined
  let capturing = false
  let stopping = false
  let settled = false
  let finalTimer: ReturnType<typeof setTimeout> | undefined
  let resolveSettled: () => void = () => undefined
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })

  const stopMicrophone = () => {
    if (!capturing) return
    capturing = false
    stream.stop()
  }

  const settle = () => {
    if (settled) return
    settled = true
    if (finalTimer !== undefined) clearTimeout(finalTimer)
    stopMicrophone()
    connection?.close()
    resolveSettled()
    void Promise.resolve(onSettle()).catch(() => undefined)
  }

  const complete = () => {
    if (settled) return
    const committed = joinSpoken({ head: spoken.committed, next: spoken.interim })
    if (committed !== spoken.committed) onEvent({ type: EDictationEvent.Final, text: committed })
    onEvent({ type: EDictationEvent.Ended })
    settle()
  }

  const fail = (message: string) => {
    if (settled) return
    onEvent({ type: EDictationEvent.Error, message })
    settle()
  }

  await stream.start()
  capturing = true
  const { token, url } = await requestToken()
  connection = open({
    url,
    token,
    handlers: {
      onPart: (part) => {
        if (settled) return
        if (part.type === ETranscriptPart.Error) {
          fail(part.message)
          return
        }
        const previous = spoken
        spoken = withTranscriptPart({ spoken, part })
        if (spoken.committed !== previous.committed)
          onEvent({ type: EDictationEvent.Final, text: spoken.committed })
        else if (spoken.interim !== previous.interim)
          onEvent({ type: EDictationEvent.Partial, text: spoken.interim })
        if (part.type === ETranscriptPart.Finish) complete()
      },
      onError: fail,
      onDone: complete,
    },
  })

  return {
    acceptBuffer: (buffer) => {
      if (settled || stopping) return
      const chunk = microphoneChunkOf(buffer)
      onEvent({ type: EDictationEvent.Level, level: chunk.level })
      for (const frame of audioFramesOf({ samples: chunk.samples })) connection?.sendAudio(frame)
    },
    stop: async () => {
      if (!stopping) {
        stopping = true
        stopMicrophone()
        connection?.finish()
        finalTimer = setTimeout(complete, FINAL_TIMEOUT_MS)
      }
      await settledPromise
    },
    cancel: () => settle(),
  }
}
