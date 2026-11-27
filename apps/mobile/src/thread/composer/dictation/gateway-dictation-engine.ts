import {
  type AudioStream,
  type AudioStreamBuffer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio'

import {
  EDictationEvent,
  type IDictationEngine,
  type IDictationSession,
  MICROPHONE_DENIED_MESSAGE,
  recordingFailedMessageOf,
  type TDictationEvent,
} from './dictation-engine'
import {
  type DictationTokenRequest,
  type IGatewaySession,
  startGatewaySession,
} from './gateway-session'

const RECORDING_MODE = { allowsRecording: true, playsInSilentMode: true }

const PLAYBACK_MODE = { allowsRecording: false, playsInSilentMode: true }

const NO_MICROPHONE_MESSAGE = 'Dictation is available on the iPhone app.'

const SILENT_SESSION: IDictationSession = {
  stop: async () => undefined,
  cancel: () => undefined,
}

export class GatewayDictationEngine implements IDictationEngine {
  private readonly stream: AudioStream | null
  private readonly requestToken: DictationTokenRequest
  private session: IGatewaySession | undefined

  constructor({
    stream,
    requestToken,
  }: {
    stream: AudioStream | null
    requestToken: DictationTokenRequest
  }) {
    this.stream = stream
    this.requestToken = requestToken
  }

  handleBuffer = (buffer: AudioStreamBuffer): void => {
    this.session?.acceptBuffer(buffer)
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
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      onEvent({ type: EDictationEvent.Error, message: MICROPHONE_DENIED_MESSAGE })
      return SILENT_SESSION
    }
    try {
      await setAudioModeAsync(RECORDING_MODE)
      this.session = await startGatewaySession({
        stream,
        requestToken: this.requestToken,
        onEvent,
      })
    } catch (error) {
      stream.stop()
      await setAudioModeAsync(PLAYBACK_MODE)
      onEvent({ type: EDictationEvent.Error, message: recordingFailedMessageOf(error) })
      return SILENT_SESSION
    }
    return {
      stop: async () => {
        await this.session?.stop()
        this.session = undefined
        await setAudioModeAsync(PLAYBACK_MODE)
      },
      cancel: () => {
        this.session?.cancel()
        this.session = undefined
        void setAudioModeAsync(PLAYBACK_MODE)
      },
    }
  }
}
