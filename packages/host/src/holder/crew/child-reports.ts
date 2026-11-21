import {
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  type EventBody,
  type EventDraft,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import type { HeldSessionDeps } from '../held-session-deps'
import { HOLDER_STATE_TYPES } from '../record/record-cache'
import type { SessionRecord } from '../record/record-adapter'

export type ChildParent = {
  deps: HeldSessionDeps
  record: SessionRecord
  threadId: ThreadId
  agentId: ThreadId
  agentType: string
  intent: string
}

const THREAD_SEQ_PAGE = 1000

export const appendOnParent = async (
  parent: ChildParent,
  drafts: readonly EventDraft[],
): Promise<void> => {
  await parent.record.append({
    threadId: parent.threadId,
    runId: parent.deps.ids.nextRunId(),
    drafts,
  })
}

export const lastSeqOf = (events: readonly V2Event[]): number => events.at(-1)?.seq ?? 0

export const threadLastSeq = async (args: {
  plane: ControlPlane
  threadId: ThreadId
}): Promise<number> => {
  let last = 0
  let afterSeq = 0
  for (;;) {
    const page = await args.plane.readEvents({
      threadId: args.threadId,
      afterSeq,
      limit: THREAD_SEQ_PAGE,
      visible: true,
      hiddenTypes: HOLDER_STATE_TYPES,
    })
    last = Math.max(last, lastSeqOf(page.events))
    if (page.next === undefined) return last
    afterSeq = page.next
  }
}

export const reportKeyOf = (args: { agentId: ThreadId; seq: number }): string =>
  `agent-reported:${args.agentId}:${args.seq}`

export const endingKeyOf = (args: { agentId: ThreadId; seq: number }): string =>
  `agent-ended:${args.agentId}:${args.seq}`

export const postNotice = async (
  parent: Pick<ChildParent, 'deps'>,
  args: { event: EventBody; key: string },
): Promise<void> => {
  await parent.deps.plane.post({
    sessionId: parent.deps.sessionId,
    kind: INBOX_KIND_EVENT,
    payload: inboxEventPayloadOf({ event: args.event, clientId: args.key }),
  })
}
