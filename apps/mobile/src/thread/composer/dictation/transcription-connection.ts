import {
  AUDIO_DONE_FRAME,
  ETranscriptPart,
  gatewayProtocolsOf,
  MAX_PENDING_AUDIO_BYTES,
  startFrameOf,
  transcriptPartOf,
  type TTranscriptPart,
} from './gateway-protocol'

export const TRANSCRIPTION_UNREACHABLE_MESSAGE = 'Dictation could not reach the speech service.'

export const TRANSCRIPTION_PREMATURE_CLOSE_MESSAGE =
  'Dictation stopped before the speech service sent the text.'

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
  let sawFinish = false
  let finishPending = false
  let pending: Uint8Array[] = []
  let pendingBytes = 0

  const dropPending = () => {
    pending = []
    pendingBytes = 0
  }

  const queue = (bytes: Uint8Array) => {
    pending.push(bytes)
    pendingBytes += bytes.byteLength
    while (pendingBytes > MAX_PENDING_AUDIO_BYTES && pending.length > 1) {
      const dropped = pending.shift()
      pendingBytes -= dropped?.byteLength ?? 0
    }
  }

  const flush = () => {
    for (const bytes of pending) socket.send(bytes)
    dropPending()
    if (!finishPending) return
    finishPending = false
    socket.send(AUDIO_DONE_FRAME)
  }

  socket.binaryType = 'arraybuffer'
  socket.onopen = () => {
    if (ended) return
    open = true
    socket.send(startFrameOf({ language: 'en' }))
    flush()
  }
  socket.onmessage = (event: { data: unknown }) => {
    if (ended || typeof event.data !== 'string') return
    const part = transcriptPartOf({ frame: event.data })
    if (part === undefined) return
    if (part.type === ETranscriptPart.Finish) sawFinish = true
    handlers.onPart(part)
  }
  socket.onerror = () => {
    if (ended) return
    ended = true
    dropPending()
    handlers.onError(TRANSCRIPTION_UNREACHABLE_MESSAGE)
  }
  socket.onclose = () => {
    if (ended) return
    ended = true
    dropPending()
    if (sawFinish) handlers.onDone()
    else handlers.onError(TRANSCRIPTION_PREMATURE_CLOSE_MESSAGE)
  }
  return {
    sendAudio: (bytes) => {
      if (ended) return
      if (!open) {
        queue(bytes)
        return
      }
      socket.send(bytes)
    },
    finish: () => {
      if (ended) return
      if (!open) {
        finishPending = true
        return
      }
      socket.send(AUDIO_DONE_FRAME)
    },
    close: () => {
      ended = true
      dropPending()
      socket.close()
    },
  }
}
