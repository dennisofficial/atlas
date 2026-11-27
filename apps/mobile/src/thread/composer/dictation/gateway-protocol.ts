export const DICTATION_SAMPLE_RATE = 16000

export const MAX_AUDIO_FRAME_BYTES = 64 * 1024

export const MAX_PENDING_AUDIO_BYTES = DICTATION_SAMPLE_RATE * 2 * 10

export const TRANSCRIPTION_SUBPROTOCOL = 'ai-gateway-transcription.v1'

const AUTH_SUBPROTOCOL_PREFIX = 'ai-gateway-auth.'

const START_FRAME_TYPE = 'transcription-stream.start'

const AUDIO_DONE_FRAME_TYPE = 'transcription-stream.audio-done'

export enum ETranscriptPart {
  Delta = 'transcript-delta',
  Partial = 'transcript-partial',
  Final = 'transcript-final',
  Finish = 'finish',
  Error = 'error',
}

export type TTranscriptPart =
  | { type: ETranscriptPart.Delta; delta: string }
  | { type: ETranscriptPart.Partial; text: string }
  | { type: ETranscriptPart.Final; text: string }
  | { type: ETranscriptPart.Finish; text: string }
  | { type: ETranscriptPart.Error; message: string }

export const gatewayProtocolsOf = ({ token }: { token: string }): readonly string[] => [
  TRANSCRIPTION_SUBPROTOCOL,
  `${AUTH_SUBPROTOCOL_PREFIX}${token}`,
]

export const startFrameOf = ({ language }: { language?: string | undefined }): string =>
  JSON.stringify({
    type: START_FRAME_TYPE,
    inputAudioFormat: { type: 'audio/pcm', rate: DICTATION_SAMPLE_RATE },
    ...(language === undefined ? {} : { providerOptions: { azure: { language } } }),
  })

export const AUDIO_DONE_FRAME = JSON.stringify({ type: AUDIO_DONE_FRAME_TYPE })

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const errorMessageOf = (value: unknown): string => {
  if (typeof value !== 'object' || value === null) return 'The transcription service stopped.'
  const message = Reflect.get(value, 'message')
  return typeof message === 'string' && message !== ''
    ? message
    : 'The transcription service stopped.'
}

export const transcriptPartOf = ({ frame }: { frame: string }): TTranscriptPart | undefined => {
  let value: unknown
  try {
    value = JSON.parse(frame)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const type = Reflect.get(value, 'type')
  switch (type) {
    case ETranscriptPart.Delta: {
      const delta = textOf(Reflect.get(value, 'delta'))
      return delta === undefined ? undefined : { type, delta }
    }
    case ETranscriptPart.Partial:
    case ETranscriptPart.Final:
    case ETranscriptPart.Finish: {
      const text = textOf(Reflect.get(value, 'text'))
      return text === undefined ? undefined : { type, text }
    }
    case ETranscriptPart.Error:
      return { type, message: errorMessageOf(Reflect.get(value, 'error')) }
    default:
      return undefined
  }
}
