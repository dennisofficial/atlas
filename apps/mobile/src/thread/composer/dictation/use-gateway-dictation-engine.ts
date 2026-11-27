import { useAudioStream } from 'expo-audio'
import { useMemo, useRef } from 'react'

import { useAuth } from '../../../auth/auth-provider'
import type { IDictationEngine } from './dictation-engine'
import { GatewayDictationEngine } from './gateway-dictation-engine'
import { DICTATION_SAMPLE_RATE } from './gateway-protocol'

const SIGNED_OUT_MESSAGE = 'Sign in to dictate.'

export const useGatewayDictationEngine = (): IDictationEngine => {
  const { api } = useAuth()
  const engineRef = useRef<GatewayDictationEngine | null>(null)
  const { stream } = useAudioStream({
    sampleRate: DICTATION_SAMPLE_RATE,
    encoding: 'int16',
    onBuffer: (buffer) => engineRef.current?.handleBuffer(buffer),
  })
  const engine = useMemo(
    () =>
      new GatewayDictationEngine({
        stream,
        requestToken: async () => {
          if (api === undefined) throw new Error(SIGNED_OUT_MESSAGE)
          return api.dictation.token.mutate({})
        },
      }),
    [api, stream],
  )
  engineRef.current = engine
  return engine
}
