import type { EventDraft, SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'
import {
  EConnectionView,
  userSaidDraft,
  wakesOnSend,
  type RemoteDeltaChannel,
  type RemoteTurnRunner,
} from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import type { PendingQueue, PendingSaid, RemotePendingEntry } from '../store'
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
 * A cloud thread's queue lives in the sandbox, which broadcasts it as pending-changed signals;
 * the local queue stays empty there, so the transcript renders this snapshot instead. The
 * channel carries the current value (pendingEntries) so a late mount does not wait for the
 * next change to show what is queued.
 */
export function useRemotePending(args: {
  app: AtlasApp
  cloudRunner: RemoteTurnRunner | null
  heldForWake: ReturnType<PendingQueue<QueuedSettled>['getSnapshot']>
}): { channel: RemoteDeltaChannel | null; entries: readonly RemotePendingEntry[] } {
  const { app, cloudRunner, heldForWake } = args
  const channel = useMemo(() => {
    if (cloudRunner === null) return null
    if (!('onPendingChanged' in app.channel)) return null
    return app.channel as RemoteDeltaChannel
  }, [app.channel, cloudRunner])

  const subscribe = useCallback(
    (listener: () => void) => channel?.onPendingChanged(listener) ?? (() => undefined),
    [channel],
  )
  const remote = useSyncExternalStore(subscribe, () => channel?.pendingEntries() ?? EMPTY_REMOTE_PENDING)

  return useMemo(() => {
    const held = heldForWake.flatMap((entry): readonly RemotePendingEntry[] =>
      entry.kind === 'message'
        ? [{ id: entry.id, text: entry.text, reserved: false, ...(entry.via === undefined ? {} : { via: entry.via }) }]
        : [],
    )
    return { channel, entries: held.length === 0 ? remote : [...remote, ...held] }
  }, [channel, heldForWake, remote])
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
  sending: ConversationSending
}): () => PendingSaid | null | Promise<PendingSaid | null> {
  const { threadId, cloudRunner, moving, pending, sending } = args

  return useCallback((): PendingSaid | null | Promise<PendingSaid | null> => {
    if (moving) return null
    const queuedHere = pending.takeBackLast()
    if (queuedHere !== null || cloudRunner === null) return queuedHere
    /**
     * A recalled steer never commits, so its "sending…" placeholder has nothing to reconcile
     * against and would stick forever. Resolve it as the recall is confirmed.
     */
    return cloudRunner.takeBackPending({ threadId }).then((said) => {
      if (said !== null) sending.resolve(said.text)
      return said
    })
  }, [cloudRunner, moving, pending, sending, threadId])
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
      if (connection.state === EConnectionView.Disconnected) sending.markAllSendingFailed()
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
  cloudView: EConnectionView | null
  wakeCloud: (() => void) | null
}): (send: SendArgs) => void {
  const { app, threadId, pending, sending, cloudRunner, working, moving, drive, setFailure } = args
  const { cloudView, wakeCloud } = args

  useCloudWakeDrain({ threadId, pending, sending, cloudRunner, cloudView, working, moving, drive })

  return useCallback(
    (send: SendArgs) => {
      const text = send.text.trim()
      const images = send.images ?? NO_IMAGES
      const files = send.files ?? NO_FILES
      if (text.length === 0) return
      if (moving) return

      const contextPart = send.context === undefined ? {} : { context: send.context }
      const requestId = crypto.randomUUID()

      if (cloudRunner !== null && cloudView !== null && wakesOnSend(cloudView)) {
        pending.enqueue({ text, images, files, ...contextPart })
        wakeCloud?.()
        return
      }

      if (working) {
        if (cloudRunner !== null) {
          sending.add(text)
          cloudRunner.steer({ threadId, text, images, files, ...contextPart })
          return
        }

        if (app.intake !== undefined) {
          app.intake.submit({ threadId, text, requestId, images, files, ...contextPart })
          return
        }

        pending.enqueue({ text, requestId, images, files, ...contextPart })
        return
      }

      if (app.intake !== undefined) {
        const shared = app.intake
        const releaseStartup = shared.hold({ threadId })
        shared.submit({ threadId, text, requestId, images, files, ...contextPart })
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
        [...(send.context ?? []), ...[...drained, { text, images, files, requestId }].map(userSaidDraft)],
        { onCommitFailed },
      )
    },
    [app.intake, cloudRunner, cloudView, drive, moving, pending, sending, setFailure, threadId, wakeCloud, working],
  )
}

const saidDrafts = (said: PendingSaid): readonly EventDraft[] => [...(said.context ?? []), userSaidDraft(said)]

const queuedMessageCount = (queue: ReturnType<PendingQueue<QueuedSettled>['getSnapshot']>): number =>
  queue.filter((entry) => entry.kind === 'message').length

function useCloudWakeDrain(args: {
  threadId: ThreadId
  pending: PendingQueue<QueuedSettled>
  sending: ConversationSending
  cloudRunner: RemoteTurnRunner | null
  cloudView: EConnectionView | null
  working: boolean
  moving: boolean
  drive: TurnDriver['drive']
}): void {
  const { threadId, pending, sending, cloudRunner, cloudView, working, moving, drive } = args
  const queued = useSyncExternalStore(pending.subscribe, pending.getSnapshot)
  const waiting = queuedMessageCount(queued)

  useEffect(() => {
    if (cloudRunner === null || cloudView !== EConnectionView.Connected) return
    if (moving || waiting === 0) return

    const drained = pending.drain()
    if (drained.length === 0) return

    if (working) {
      for (const said of drained) {
        sending.add(said.text)
        cloudRunner.steer({
          threadId,
          text: said.text,
          images: said.images,
          files: said.files,
          ...(said.context === undefined ? {} : { context: said.context }),
        })
      }
      return
    }

    const sendingIds = drained.map((said) => sending.add(said.text))
    const onCommitFailed = (): void => {
      for (const id of sendingIds) sending.markFailed(id)
    }
    void drive(drained.flatMap(saidDrafts), { onCommitFailed })
  }, [cloudRunner, cloudView, drive, moving, pending, sending, threadId, waiting, working])
}
