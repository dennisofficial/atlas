import type { ThreadId } from '@dltech/atlas-core'
import { useCallback } from 'react'

import type { ModelWaitControlState } from '../ui/model-wait-view'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'
import { useResumeOnOpen } from './use-conversation-resume'
import { useAvailabilityRootWake } from './use-availability-root-wake'
import { useModelAvailability } from './use-model-availability'
import { useRunAttention, type RunAttentionControl } from './use-run-attention'
import type { TurnDriver } from './turn-driver-types'
import type { ThreadView } from './use-thread-view'

export type ConversationAttention = RunAttentionControl & { modelWait: ModelWaitControlState }

export function useConversationAttention(args: {
  app: AtlasApp
  threadId: ThreadId
  view: ThreadView
  turnDriver: TurnDriver
  remote: boolean
  moving: boolean
  channelReady: boolean
  opened: OpenedConversation
  onFailure: (reason: string) => void
}): ConversationAttention {
  const { app, threadId, view, turnDriver, opened, moving } = args
  const availability = useModelAvailability({ app, threadId, events: view.events })
  const attention = useRunAttention({
    app,
    threadId,
    view,
    turnDriver,
    remote: args.remote,
    moving,
    channelReady: args.channelReady,
    onFailure: args.onFailure,
    waiting: { live: availability.waitingLive, accountLabelOf: availability.accountLabelOf },
  })

  useResumeOnOpen({
    app,
    opened,
    turnDriver,
    moving,
    resumable: attention.handleResume !== null,
  })

  const { turnInFlight, drive } = turnDriver
  const handleWake = useCallback(() => {
    if (turnInFlight()) return
    void drive([])
  }, [drive, turnInFlight])
  useAvailabilityRootWake({ control: app.availabilityControl, threadId, onWake: handleWake })

  return { ...attention, modelWait: availability.control }
}
