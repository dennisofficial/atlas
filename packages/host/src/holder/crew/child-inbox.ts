import type { ThreadId } from '@dltech/atlas-core'

import { EIntakeScope } from '../intake-scope'
import { InboxIntake } from '../inbox-intake'
import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'

export type ChildInbox = {
  intake: InboxIntake
  post(input: { kind: string; payload: string; receipt?: string | undefined }): Promise<void>
}

export const childInboxOf = (args: {
  deps: HeldSessionDeps
  record: SessionRecord
  threadId: ThreadId
}): ChildInbox => {
  const intake = new InboxIntake({
    plane: args.deps.plane,
    sessionId: args.deps.sessionId,
    record: args.record,
    threadId: args.threadId,
    runId: () => args.deps.ids.nextRunId(),
    scope: EIntakeScope.Child,
    ...(args.deps.log === undefined ? {} : { log: args.deps.log }),
  })
  return {
    intake,
    post: async (input) => {
      await args.deps.plane.post({
        sessionId: args.deps.sessionId,
        kind: input.kind,
        payload: input.payload,
        threadId: args.threadId,
        ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
      })
      await intake.stage()
    },
  }
}
