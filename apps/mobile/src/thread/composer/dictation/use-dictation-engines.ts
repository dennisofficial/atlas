import { useAudioStream } from 'expo-audio'
import { useMemo, useRef } from 'react'

import { FakeDictationEngine, fakeTranscriptStepsOf } from './fake-dictation-engine'
import { MIC_SAMPLE_RATE, MicDictationEngine } from './mic-dictation-engine'

export interface IDictationEngines {
  fake: FakeDictationEngine
  mic: MicDictationEngine
}

export const useDictationEngines = (): IDictationEngines => {
  const micRef = useRef<MicDictationEngine | null>(null)
  const { stream } = useAudioStream({
    sampleRate: MIC_SAMPLE_RATE,
    encoding: 'float32',
    onBuffer: (buffer) => micRef.current?.handleBuffer(buffer),
  })
  const fake = useMemo(() => new FakeDictationEngine(), [])
  const mic = useMemo(
    () => new MicDictationEngine({ stream, steps: fakeTranscriptStepsOf() }),
    [stream],
  )
  micRef.current = mic
  return { fake, mic }
}
