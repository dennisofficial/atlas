import type { SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'
import {
  EChannelConnection,
  userSaidDraft,
  type RemoteDeltaChannel,
  type RemoteTurnRunner,
} from '@dltech/atlas-harness'
import { useCallback, useEffect } from 'react'

import type { PendingQueue } from '../store'
import type { QueuedSettled } from './commands'
import type { AtlasApp } from './compose'
import type { SendArgs } from './conversation-types'
import type { OpenedConversation } from './open-conversation'
import { useSendingRows } from './use-sending-rows'
import type { TurnDriver } from './use-turn-driver'

const NO_IMAGES: readonly SaidImage[] = Object.freeze([])
const NO_FILES: readonly SaidFile[] = Object.freeze([])

export type ConversationSending = ReturnType<typeof useSendingRows>

export function useSendingChannel(args: {
  app: AtlasApp
  cloudRunner: RemoteTurnRunner | null
  opened: OpenedConversation
}): ConversationSending {
  const { app, cloudRunner, opened } = args
  const sending = useSendingRows()

  useEffect(() => sending.reconcile(opened.events), [opened, sending])

  useEffect(() => {
    if (cloudRunner === null) return undefined

    const channel = app.channel
    if (!('onConnection' in channel)) return undefined

    return (channel as RemoteDeltaChannel).onConnection((connection) => {
      if (connection.state === EChannelConnection.Closed) sending.markAllSendingFailed()
    })
  }, [app.channel, cloudRunner, sending])

  return sending
}

export function useSendMessage(args: {
  app: AtlasApp
  threadId: ThreadId
  pending: PendingQueue<QueuedSettled>
  sending: ConversationSending
  cloudRunner: RemoteTurnRunner | null
  working: boolean
  drive: TurnDriver['drive']
  setFailure: (message: string) => void
}): (send: SendArgs) => void {
  const { app, threadId, pending, sending, cloudRunner, working, drive, setFailure } = args

  return useCallback(
    (send: SendArgs) => {
      const text = send.text.trim()
      const images = send.images ?? NO_IMAGES
      const files = send.files ?? NO_FILES
      if (text.length === 0) return

      const contextPart = send.context === undefined ? {} : { context: send.context }

      if (working) {
        if (cloudRunner !== null) {
          sending.add(text)
          cloudRunner.steer({ threadId, text, images, files, ...contextPart })
          return
        }

        if (app.intake !== undefined) {
          app.intake.submit({ threadId, text, images, files, ...contextPart })
          return
        }

        pending.enqueue({ text, images, files, ...contextPart })
        return
      }

      if (app.intake !== undefined) {
        const shared = app.intake
        const releaseStartup = shared.hold({ threadId })
        shared.submit({ threadId, text, images, files, ...contextPart })
        void (async () => {
          let releaseBatch: (() => void) | undefined
          try {
            const batch = await shared.prepare({ threadId })
            releaseBatch = batch.release
            await drive(batch.drafts, {
              onCommitted: () => batch.acknowledge(),
              onCommitFailed: () => batch.release?.(),
            })
          } catch (error) {
            setFailure(error instanceof Error ? error.message : 'could not commit the message')
          } finally {
            releaseBatch?.()
            releaseStartup()
          }
        })()
        return
      }

      const drained = [...pending.drain()]
      const sendingId = sending.add(text)
      const onCommitFailed = (): void => {
        for (const said of drained) sending.resolve(said.text)
        sending.markFailed(sendingId)
      }

      drive(
        [...(send.context ?? []), ...[...drained, { text, images, files }].map(userSaidDraft)],
        { onCommitFailed },
      )
    },
    [app.intake, cloudRunner, drive, pending, sending, setFailure, threadId, working],
  )
}
