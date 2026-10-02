import type { SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'
import {
  EChannelConnection,
  userSaidDraft,
  type RemoteDeltaChannel,
  type RemoteTurnRunner,
} from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { pendingRows, type PendingQueue, type PendingRow, type PendingSaid, type RemotePendingEntry } from '../store'
import type { QueuedSettled } from './commands'
import type { AtlasApp } from './compose'
import type { SendArgs } from './conversation-types'
import type { OpenedConversation } from './open-conversation'
import { useSendingRows } from './use-sending-rows'
import type { TurnDriver } from './use-turn-driver'

const NO_IMAGES: readonly SaidImage[] = Object.freeze([])
const NO_FILES: readonly SaidFile[] = Object.freeze([])
const EMPTY_REMOTE_PENDING: readonly RemotePendingEntry[] = Object.freeze([])

/**
 * A placement move (lift, descend, container switch) freezes the transcript: the loop is paused
 * and the log is mid-transfer, so retry, resume, send, and every log-editing command read this
 * one durable flag rather than any UI-local move state — it survives the remount across a lift.
 */
export function usePlacementMoving(args: { app: AtlasApp; threadId: ThreadId }): boolean {
  const { app, threadId } = args
  return useSyncExternalStore(
    app.executionLocation.subscribe,
    () => app.executionLocation.moveFor(threadId) !== null,
  )
}

/**
 * A cloud thread's queue lives in the sandbox, which broadcasts it as pending-changed signals;
 * the local queue stays empty there, so the transcript renders this snapshot instead. The
 * channel carries the current value (pendingEntries) so a late mount does not wait for the
 * next change to show what is queued.
 */
export function useRemotePending(args: {
  app: AtlasApp
  cloudRunner: RemoteTurnRunner | null
}): { channel: RemoteDeltaChannel | null; entries: readonly RemotePendingEntry[] } {
  const { app, cloudRunner } = args
  const channel = useMemo(() => {
    if (cloudRunner === null) return null
    if (!('onPendingChanged' in app.channel)) return null
    return app.channel as RemoteDeltaChannel
  }, [app.channel, cloudRunner])

  const subscribe = useCallback(
    (listener: () => void) => channel?.onPendingChanged(listener) ?? (() => undefined),
    [channel],
  )
  const entries = useSyncExternalStore(subscribe, () => channel?.pendingEntries() ?? EMPTY_REMOTE_PENDING)

  return useMemo(() => ({ channel, entries }), [channel, entries])
}

/**
 * Only the queue is taken back: once the loop has drained a message into the log, the edit route
 * is interrupt-and-resend, not a second retraction path that would have to race the stream.
 *
 * The cloud queue lives in the sandbox, so the take-back is a wire request and the draft fills
 * only once the sandbox's reply confirms the message was still queued — a null answer means the
 * turn's intake already claimed it, and the row keeps rendering instead of being edited twice.
 */
export function useTakeBackPending(args: {
  threadId: ThreadId
  cloudRunner: RemoteTurnRunner | null
  moving: boolean
  pending: PendingQueue<QueuedSettled>
}): () => PendingSaid | null | Promise<PendingSaid | null> {
  const { threadId, cloudRunner, moving, pending } = args

  return useCallback((): PendingSaid | null | Promise<PendingSaid | null> => {
    if (moving) return null
    if (cloudRunner === null) return pending.takeBackLast()
    return cloudRunner.takeBackPending({ threadId })
  }, [cloudRunner, moving, pending, threadId])
}

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
  moving: boolean
  drive: TurnDriver['drive']
  setFailure: (message: string) => void
}): (send: SendArgs) => void {
  const { app, threadId, pending, sending, cloudRunner, working, moving, drive, setFailure } = args

  return useCallback(
    (send: SendArgs) => {
      const text = send.text.trim()
      const images = send.images ?? NO_IMAGES
      const files = send.files ?? NO_FILES
      if (text.length === 0) return
      if (moving) return

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
    [app.intake, cloudRunner, drive, moving, pending, sending, setFailure, threadId, working],
  )
}
