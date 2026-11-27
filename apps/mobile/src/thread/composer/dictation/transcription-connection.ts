import {
  AUDIO_DONE_FRAME,
  gatewayProtocolsOf,
  startFrameOf,
  transcriptPartOf,
  type TTranscriptPart,
} from './gateway-protocol'

export const TRANSCRIPTION_UNREACHABLE_MESSAGE = 'Dictation could not reach the speech service.'

export interface ITranscriptionHandlers {
  onPart: (part: TTranscriptPart) => void
  onError: (message: string) => void
  onDone: () => void
}

export interface ITranscriptionConnection {
  sendAudio: (bytes: Uint8Array) => void
  finish: () => void
  close: () => void
}

export type OpenTranscription = (args: {
  url: string
  token: string
  handlers: ITranscriptionHandlers
}) => ITranscriptionConnection

export const openTranscription: OpenTranscription = ({ url, token, handlers }) => {
  const socket = new WebSocket(url, [...gatewayProtocolsOf({ token })])
  let open = false
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    handlers.onDone()
  }
  socket.binaryType = 'arraybuffer'
  socket.onopen = () => {
    open = true
    socket.send(startFrameOf({ language: 'en' }))
  }
  socket.onmessage = (event: { data: unknown }) => {
    if (typeof event.data !== 'string') return
    const part = transcriptPartOf({ frame: event.data })
    if (part !== undefined) handlers.onPart(part)
  }
  socket.onerror = () => {
    if (ended) return
    ended = true
    handlers.onError(TRANSCRIPTION_UNREACHABLE_MESSAGE)
  }
  socket.onclose = () => end()
  return {
    sendAudio: (bytes) => {
      if (!open || ended) return
      socket.send(bytes)
    },
    finish: () => {
      if (!open || ended) return
      socket.send(AUDIO_DONE_FRAME)
    },
    close: () => {
      ended = true
      socket.close()
    },
  }
}
