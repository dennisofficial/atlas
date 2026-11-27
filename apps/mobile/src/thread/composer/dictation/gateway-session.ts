import { EDictationEvent, type IDictationSession, type TDictationEvent } from './dictation-engine'
import { ETranscriptPart } from './gateway-protocol'
import { EMPTY_SPOKEN, joinSpoken, withTranscriptPart } from './mai-transcript'
import type { ITranscript } from './transcript-model'
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
}: {
  stream: IDictationAudioStream
  requestToken: DictationTokenRequest
  open?: OpenTranscription
  onEvent: (event: TDictationEvent) => void
}): Promise<IGatewaySession> => {
  let transcript: ITranscript = EMPTY_SPOKEN
  let connection: ITranscriptionConnection | undefined
  let finished = false
  let resolveClosed: () => void = () => undefined
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })

  const push = (next: ITranscript) => {
    if (next.committed !== transcript.committed) {
      transcript = next
      onEvent({ type: EDictationEvent.Final, text: next.committed })
      return
    }
    if (next.interim !== transcript.interim) {
      transcript = next
      onEvent({ type: EDictationEvent.Partial, text: next.interim })
    }
  }

  const complete = () => {
    if (finished) return
    finished = true
    const committed = joinSpoken({ head: transcript.committed, next: transcript.interim })
    if (committed !== transcript.committed)
      onEvent({ type: EDictationEvent.Final, text: committed })
    onEvent({ type: EDictationEvent.Ended })
    resolveClosed()
  }

  const fail = (message: string) => {
    if (finished) return
    finished = true
    onEvent({ type: EDictationEvent.Error, message })
    connection?.close()
    resolveClosed()
  }

  await stream.start()
  const { token, url } = await requestToken()
  connection = open({
    url,
    token,
    handlers: {
      onPart: (part) => {
        if (finished) return
        if (part.type === ETranscriptPart.Error) {
          fail(part.message)
          return
        }
        push(withTranscriptPart({ transcript, part }))
        if (part.type === ETranscriptPart.Finish) complete()
      },
      onError: fail,
      onDone: complete,
    },
  })

  return {
    acceptBuffer: (buffer) => {
      if (finished) return
      const chunk = microphoneChunkOf(buffer)
      onEvent({ type: EDictationEvent.Level, level: chunk.level })
      for (const frame of audioFramesOf({ samples: chunk.samples })) connection?.sendAudio(frame)
    },
    stop: async () => {
      stream.stop()
      connection?.finish()
      const timer = setTimeout(complete, FINAL_TIMEOUT_MS)
      await closed
      clearTimeout(timer)
      connection?.close()
    },
    cancel: () => {
      finished = true
      stream.stop()
      connection?.close()
      resolveClosed()
    },
  }
}
