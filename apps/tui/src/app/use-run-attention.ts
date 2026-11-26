import type { Event, RecordEvent } from '@dltech/atlas-core'
import { ERunRemedy, resumableOf, resumePointOf } from '@dltech/atlas-core'
import {
  INTERRUPTED_TITLE,
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

const resumeAttention = (): RunAttention => ({
  failure: null,
  message: INTERRUPTED_TITLE,
  failureSeq: null,
  runId: null,
  remedies: [{ remedy: ERunRemedy.Resume, enabled: true }],
  dismissible: false,
  busyReason: null,
})

export function useRunAttention(args: {
  api: SessionApi
  sessionId: string
  events: readonly Event[]
  foldable: readonly RecordEvent[]
  live: readonly InFlightStep[]
  working: boolean
  connected: boolean
  onProblem: (reason: string) => void
}): RunAttentionControl {
  const { api, sessionId, events, foldable, live, working, connected } = args
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem

  const resumable = useMemo(() => resumableOf(resumePointOf({ events: foldable })), [foldable])

  const attention = useMemo(() => {
    const found = runAttentionOf({
      events,
      live,
      working,
      turnInFlight: working,
      channelReady: connected,
      settling: false,
    })
    if (found !== null) return found
    if (!resumable || working || !connected) return null
    return resumeAttention()
  }, [connected, events, live, working, resumable])

  const rerun = useCallback(() => {
    void api.retry({ sessionId }).catch((failure: unknown) => {
      problem.current(messageOf(failure))
    })
  }, [api, sessionId])

  const resume = useCallback(() => {
    void api.runCommand({ sessionId, name: 'resume', args: {} }).catch((failure: unknown) => {
      problem.current(messageOf(failure))
    })
  }, [api, sessionId])

  const enabled = (remedy: ERunRemedy): boolean =>
    attention?.remedies.some((entry) => entry.remedy === remedy && entry.enabled) === true

  return {
    attention,
    handleRetry: enabled(ERunRemedy.Retry) ? rerun : null,
    handleResume: resumable && enabled(ERunRemedy.Resume) ? resume : null,
    handleDismiss: null,
  }
}
