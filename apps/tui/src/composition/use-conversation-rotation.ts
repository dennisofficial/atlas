import type { ThreadId } from '@dltech/atlas-core'
import type {
  EConnectionView,
  PendingQueue,
  PendingSaid,
  PodSession,
  RemoteTurnRunner,
} from '@dltech/atlas-harness'

import type { Rotating } from '../ui/components/rotating-line'
import type { AtlasApp } from './compose'
import type { SendArgs } from './conversation-types'
import type { QueuedSettled } from './commands'
import { useRotation } from './use-rotation'
import {
  useSendMessage,
  useTakeBackPending,
  type ConversationSending,
} from './use-conversation-send'
import type { TurnDriver } from './turn-driver-types'

export type ConversationRotation = {
  rotating: Rotating | null
  handleRotate: (instructions: string | undefined) => void
  cancelRotation: () => boolean
  handleSend: (send: SendArgs) => void
  handleTakeBackPending: () => PendingSaid | null | Promise<PendingSaid | null>
}

export function useConversationRotation(args: {
  app: AtlasApp
  threadId: ThreadId
  readClock: () => number
  compacting: boolean
  moving: boolean
  working: boolean
  pending: PendingQueue<QueuedSettled>
  sending: ConversationSending
  cloudRunner: RemoteTurnRunner | null
  cloudSession: PodSession | null
  cloudView: EConnectionView | null
  driver: TurnDriver
  refresh: () => Promise<void>
  setFailure: (reason: string) => void
  onRotated: () => void
}): ConversationRotation {
  const { app, threadId, readClock, compacting, moving, working, pending, sending, cloudRunner } =
    args
  const { cloudSession, driver, refresh, setFailure, onRotated, cloudView } = args

  const { rotating, handleRotate, cancel } = useRotation({
    app,
    threadId,
    readClock,
    compacting,
    moving,
    driver,
    refresh,
    onFailure: setFailure,
    onRotated,
  })

  const handleSend = useSendMessage({
    app,
    threadId,
    pending,
    sending,
    cloudRunner,
    cloudSession,
    working: working || rotating !== null,
    moving,
    drive: driver.drive,
    setFailure,
    cloudView,
  })
  const handleTakeBackPending = useTakeBackPending({
    threadId,
    cloudRunner,
    moving,
    pending,
    sending,
  })

  return { rotating, handleRotate, cancelRotation: cancel, handleSend, handleTakeBackPending }
}
