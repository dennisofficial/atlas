import {
  CallHandedOffError,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type ThreadId,
} from '@dltech/atlas-core'

import type { HeldSessionDeps } from './held-session-deps'
import { LeaseLostError } from './record/lease-lost-error'
import { holdsLatestFact } from './record/latest-fact'
import type { SessionRecord } from './record/record-adapter'

export const podAppendOf =
  ({
    record,
    threadId,
    deps,
  }: {
    record: SessionRecord
    threadId: ThreadId
    deps: HeldSessionDeps
  }) =>
  async (drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void> => {
    const fresh = drafts.filter((draft) => !holdsLatestFact({ record, draft }))
    if (fresh.length === 0) return
    try {
      await record.append({ threadId, runId: deps.ids.nextRunId(), drafts: fresh })
    } catch (error) {
      if (error instanceof LeaseLostError && error.refusal === 'self-fenced') {
        throw new CallHandedOffError(
          `the holder handed the record back before this work was recorded: ${error.message}`,
        )
      }
      throw error
    }
  }
