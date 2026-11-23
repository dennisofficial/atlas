import type { Event } from '@dltech/atlas-core'
import { ERunRemedy } from '@dltech/atlas-core'
import {
  runAttentionOf,
  type InFlightStep,
  type RunAttention,
  type TranscriptModel,
} from '@dltech/atlas-client/transcript'
import { useCallback, useMemo, useRef } from 'react'

import type { SessionApi } from './session-api'

export type RunAttentionControl = {
  attention: RunAttention | null
  handleRetry: (() => void) | null
  handleResume: (() => void) | null
  handleDismiss: (() => void) | null
}

export const modelWithAttentionFailure = (args: {
  model: TranscriptModel
  attention: RunAttention | null
  working: boolean
}): TranscriptModel => {
  if (args.model.failure !== null || args.model.streaming || args.working) return args.model
  const failure = args.attention?.failure
  if (failure === null || failure === undefined) return args.model
  return {
    ...args.model,
    failure: {
      message: args.attention?.message ?? '',
      failure,
      runId: args.attention?.runId ?? null,
    },
  }
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useRunAttention(args: {
  api: SessionApi
  sessionId: string
  events: readonly Event[]
  live: readonly InFlightStep[]
  working: boolean
  connected: boolean
  onProblem: (reason: string) => void
}): RunAttentionControl {
  const { api, sessionId, events, live, working, connected } = args
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem

  const attention = useMemo(
    () =>
      runAttentionOf({
        events,
        live,
        working,
        turnInFlight: working,
        channelReady: connected,
        settling: false,
      }),
    [connected, events, live, working],
  )

  const rerun = useCallback(() => {
    void api.retry({ sessionId }).catch((failure: unknown) => {
      problem.current(messageOf(failure))
    })
  }, [api, sessionId])

  const enabled = (remedy: ERunRemedy): boolean =>
    attention?.remedies.some((entry) => entry.remedy === remedy && entry.enabled) === true

  return {
    attention,
    handleRetry: enabled(ERunRemedy.Retry) ? rerun : null,
    handleResume: enabled(ERunRemedy.Resume) ? rerun : null,
    handleDismiss: null,
  }
}
