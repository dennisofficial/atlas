import type { ThreadId } from '@dltech/atlas-core'
import type { PendingQueue, PendingSaid, RemoteTurnRunner } from '@dltech/atlas-harness'

import type { Rotating } from '../ui/components/rotating'
import type { AtlasApp } from './compose'
import type { SendArgs } from './conversation-types'
import type { QueuedSettled } from './commands'
import { useRotation } from './use-rotation'
import { useSendMessage, useTakeBackPending, type ConversationSending } from './use-conversation-send'
import type { TurnDriver } from './turn-driver-types'

export type ConversationRotation = {
  rotating: Rotating | null
  handleRotate: (instructions: string | undefined) => void
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
  driver: TurnDriver
  setFailure: (reason: string) => void
  onRotated: (args: { successor: ThreadId }) => void
}): ConversationRotation {
  const { app, threadId, readClock, compacting, moving, working, pending, sending, cloudRunner } =
    args
  const { driver, setFailure, onRotated } = args

  const { rotating, handleRotate } = useRotation({
    app,
    threadId,
    readClock,
    compacting,
    moving,
    driver,
    onFailure: setFailure,
    onRotated,
  })

  const handleSend = useSendMessage({
    app,
    threadId,
    pending,
    sending,
    cloudRunner,
    working: working || rotating !== null,
    moving,
    drive: driver.drive,
    setFailure,
  })
  const handleTakeBackPending = useTakeBackPending({
    threadId,
    cloudRunner,
    moving,
    pending,
    sending,
  })

  return { rotating, handleRotate, handleSend, handleTakeBackPending }
}
