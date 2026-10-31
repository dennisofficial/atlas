import { runAttentionOf, type RunAttention } from '@dltech/atlas-client/transcript'
import { ERunRemedy, type ThreadId } from '@dltech/atlas-core'
import {
  dismissRunFailure,
  type DeltaChannel,
  type RemoteDeltaChannel,
} from '@dltech/atlas-harness'
import { useCallback } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'
import type { TurnDriver } from './turn-driver-types'
import type { ThreadView } from './use-thread-view'

const isRemoteChannel = (channel: DeltaChannel): channel is RemoteDeltaChannel =>
  'dismissFailure' in channel

const DISMISS_UNSUPPORTED = 'This sandbox runs an older serve that cannot close failures.'

export type RunAttentionControl = {
  attention: RunAttention | null
  handleRetry: (() => void) | null
  handleResume: (() => void) | null
  handleDismiss: (() => void) | null
}

export function useRunAttention(args: {
  app: AtlasApp
  threadId: ThreadId
  view: ThreadView
  turnDriver: TurnDriver
  remote: boolean
  moving: boolean
  channelReady: boolean
  onFailure: (reason: string) => void
}): RunAttentionControl {
  const { app, threadId, view, turnDriver, remote, moving, channelReady, onFailure } = args
  const { refresh } = view

  const attention = runAttentionOf({
    events: view.events,
    live: view.store.liveSteps(),
    working: turnDriver.working,
    turnInFlight: turnDriver.turnInFlight(),
    channelReady: channelReady && !moving,
    settling: turnDriver.settling,
  })

  const enabled = (remedy: ERunRemedy): boolean =>
    attention?.remedies.some((entry) => entry.remedy === remedy && entry.enabled) === true

  const failureSeq = attention?.dismissible === true ? attention.failureSeq : null
  const runId = attention?.runId ?? null

  const handleDismiss = useCallback(() => {
    if (failureSeq === null) return
    if (remote && isRemoteChannel(app.channel)) {
      if (app.channel.dismissFailure({ failureSeq })) return
      notify({
        key: 'dismiss-unsupported',
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: DISMISS_UNSUPPORTED,
      })
      return
    }
    void dismissRunFailure({
      log: app.log,
      threadId,
      runId: runId ?? app.ids.nextRunId(),
      failureSeq,
    })
      .then(refresh)
      .catch((error: unknown) => onFailure(messageOf(error)))
  }, [app.channel, app.ids, app.log, failureSeq, onFailure, refresh, remote, runId, threadId])

  return {
    attention,
    handleRetry: enabled(ERunRemedy.Retry) ? turnDriver.handleRetry : null,
    handleResume: enabled(ERunRemedy.Resume) ? turnDriver.handleResume : null,
    handleDismiss: failureSeq === null ? null : handleDismiss,
  }
}
