import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'

import {
  EDictationEvent,
  type IDictationEngine,
  type IDictationSession,
  MICROPHONE_DENIED_MESSAGE,
  recordingFailedMessageOf,
  type TDictationEvent,
} from './dictation-engine'
import { MAX_PENDING_AUDIO_BYTES } from './gateway-protocol'
import {
  type DictationTokenRequest,
  type IGatewayAudioBuffer,
  type IGatewaySession,
  type IDictationAudioStream,
  startGatewaySession,
} from './gateway-session'
import type { OpenTranscription } from './transcription-connection'

const RECORDING_MODE = { allowsRecording: true, playsInSilentMode: true }

const PLAYBACK_MODE = { allowsRecording: false, playsInSilentMode: true }

const NO_MICROPHONE_MESSAGE = 'Dictation is available on the iPhone app.'

const SILENT_SESSION: IDictationSession = {
  stop: async () => undefined,
  cancel: () => undefined,
}

export class GatewayDictationEngine implements IDictationEngine {
  private readonly stream: IDictationAudioStream | null
  private readonly requestToken: DictationTokenRequest
  private readonly open: OpenTranscription | undefined
  private session: IGatewaySession | undefined
  private pending: IGatewayAudioBuffer[] = []
  private pendingBytes = 0
  private starting = false

  constructor({
    stream,
    requestToken,
    open,
  }: {
    stream: IDictationAudioStream | null
    requestToken: DictationTokenRequest
    open?: OpenTranscription | undefined
  }) {
    this.stream = stream
    this.requestToken = requestToken
    this.open = open
  }

  handleBuffer = (buffer: IGatewayAudioBuffer): void => {
    const session = this.session
    if (session !== undefined) {
      session.acceptBuffer(buffer)
      return
    }
    if (!this.starting) return
    this.pending.push(buffer)
    this.pendingBytes += buffer.data.byteLength
    while (this.pendingBytes > MAX_PENDING_AUDIO_BYTES && this.pending.length > 1) {
      const dropped = this.pending.shift()
      this.pendingBytes -= dropped?.data.byteLength ?? 0
    }
  }

  start = async ({
    onEvent,
  }: {
    onEvent: (event: TDictationEvent) => void
  }): Promise<IDictationSession> => {
    const stream = this.stream
    if (stream === null) {
      onEvent({ type: EDictationEvent.Error, message: NO_MICROPHONE_MESSAGE })
      return SILENT_SESSION
    }
    this.starting = true
    try {
      const permission = await requestRecordingPermissionsAsync()
      if (!permission.granted) {
        this.starting = false
        onEvent({ type: EDictationEvent.Error, message: MICROPHONE_DENIED_MESSAGE })
        return SILENT_SESSION
      }
      await setAudioModeAsync(RECORDING_MODE)
      const session = await startGatewaySession({
        stream,
        requestToken: this.requestToken,
        open: this.open,
        onEvent,
        onSettle: this.settle,
      })
      this.session = session
      this.starting = false
      this.flush(session)
      return {
        stop: () => session.stop(),
        cancel: () => session.cancel(),
      }
    } catch (error) {
      this.starting = false
      stream.stop()
      await this.settle()
      onEvent({ type: EDictationEvent.Error, message: recordingFailedMessageOf(error) })
      return SILENT_SESSION
    }
  }

  private settle = async (): Promise<void> => {
    this.starting = false
    this.session = undefined
    this.pending = []
    this.pendingBytes = 0
    await setAudioModeAsync(PLAYBACK_MODE).catch(() => undefined)
  }

  private flush = (session: IGatewaySession): void => {
    const queued = this.pending
    this.pending = []
    this.pendingBytes = 0
    for (const buffer of queued) session.acceptBuffer(buffer)
  }
}
