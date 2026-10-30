import type { EventDraft, ThreadId } from '@dltech/atlas-core'
import { EConnectionView, userSaidDraft, type RemoteTurnRunner } from '@dltech/atlas-harness'
import { useEffect, useSyncExternalStore } from 'react'

import type { PendingQueue, PendingSaid } from '../store'
import { withOldServeSkillContext } from './client-skill-context'
import type { QueuedSettled } from './commands'
import type { AtlasApp } from './compose'
import type { ConversationSending } from './use-conversation-send'
import type { TurnDriver } from './use-turn-driver'

const saidDrafts = (said: PendingSaid): readonly EventDraft[] => [
  ...(said.context ?? []),
  userSaidDraft(said),
]

const queuedMessageCount = (
  queue: ReturnType<PendingQueue<QueuedSettled>['getSnapshot']>,
): number => queue.filter((entry) => entry.kind === 'message').length

export function useCloudWakeDrain(args: {
  app: AtlasApp
  threadId: ThreadId
  pending: PendingQueue<QueuedSettled>
  sending: ConversationSending
  cloudRunner: RemoteTurnRunner | null
  cloudView: EConnectionView | null
  working: boolean
  moving: boolean
  drive: TurnDriver['drive']
}): void {
  const { app, threadId, pending, sending, cloudRunner, cloudView, working, moving, drive } = args
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
        const context = withOldServeSkillContext({
          app,
          text: said.text,
          context: said.context ?? [],
        })
        cloudRunner.steer({
          threadId,
          text: said.text,
          images: said.images,
          files: said.files,
          ...(context.length === 0 ? {} : { context }),
        })
      }
      return
    }

    const sendingIds = drained.map((said) => sending.add(said.text))
    const onCommitFailed = (): void => {
      for (const id of sendingIds) sending.markFailed(id)
    }
    void drive(drained.flatMap(saidDrafts), { onCommitFailed })
  }, [app, cloudRunner, cloudView, drive, moving, pending, sending, threadId, waiting, working])
}
