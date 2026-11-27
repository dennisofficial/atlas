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
import { type IDictationStep, startScriptOf } from './dictation-script'
import { micLevelOfBuffer } from './mic-level'

export const MIC_SAMPLE_RATE = 16000

const RECORDING_MODE = { allowsRecording: true, playsInSilentMode: true }

const PLAYBACK_MODE = { allowsRecording: false, playsInSilentMode: true }

const SILENT_SESSION: IDictationSession = {
  stop: async () => undefined,
  cancel: () => undefined,
}

export class MicDictationEngine implements IDictationEngine {
  private readonly stream: AudioStream
  private readonly steps: readonly IDictationStep[]
  private listener: ((event: TDictationEvent) => void) | undefined

  constructor({ stream, steps }: { stream: AudioStream; steps: readonly IDictationStep[] }) {
    this.stream = stream
    this.steps = steps
  }

  handleBuffer = (buffer: AudioStreamBuffer): void => {
    if (this.listener === undefined) return
    this.listener({ type: EDictationEvent.Level, level: micLevelOfBuffer({ data: buffer.data }) })
  }

  start = async ({
    onEvent,
  }: {
    onEvent: (event: TDictationEvent) => void
  }): Promise<IDictationSession> => {
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      onEvent({ type: EDictationEvent.Error, message: MICROPHONE_DENIED_MESSAGE })
      return SILENT_SESSION
    }
    try {
      await setAudioModeAsync(RECORDING_MODE)
      await this.stream.start()
    } catch (error) {
      await setAudioModeAsync(PLAYBACK_MODE)
      onEvent({ type: EDictationEvent.Error, message: recordingFailedMessageOf(error) })
      return SILENT_SESSION
    }
    this.listener = onEvent
    const script = startScriptOf({ steps: this.steps, onEvent })
    const release = async () => {
      this.listener = undefined
      this.stream.stop()
      await setAudioModeAsync(PLAYBACK_MODE)
    }
    return {
      stop: async () => {
        await script.stop()
        await release()
      },
      cancel: () => {
        script.cancel()
        void release()
      },
    }
  }
}
