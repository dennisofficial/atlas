import { EAgentStatus, EKilledBy, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import type { NoticeDelivery } from './delivery'
import type { Relocation } from './relocate-children'

const isTerminalEnding = (draft: EventDraft): boolean =>
  draft.type === 'agent-ended' &&
  (draft.status === EAgentStatus.Finished ||
    draft.status === EAgentStatus.Failed ||
    (draft.status === EAgentStatus.Stopped &&
      draft.killedBy !== undefined &&
      draft.killedBy !== EKilledBy.ContainerSwitch))

const pendingEndings = new WeakMap<NoticeDelivery, Map<ThreadId, readonly EventDraft[]>>()

export async function flushPendingEndings({
  threadId,
  deps,
  delivery,
}: {
  threadId: ThreadId
} & Pick<Relocation, 'deps' | 'delivery'>): Promise<void> {
  const pending = pendingEndings.get(delivery) ?? new Map<ThreadId, readonly EventDraft[]>()
  pendingEndings.set(delivery, pending)
  const drafts = [
    ...(pending.get(threadId) ?? []),
    ...delivery.drainEndings({ threadId, where: (notice) => isTerminalEnding(notice.draft) }),
  ]
  if (drafts.length === 0) return
  pending.set(threadId, drafts)
  await deps.log.append({ threadId, runId: deps.ids.nextRunId(), drafts })
  pending.delete(threadId)
}
