import {
  withoutRepeatedContext,
  type EventDraft,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { baseFactDraftsOf } from './held-prepare-bases'
import { attemptFieldOf } from './prepare-attempt'
import { bootDraftOf } from './prepare-notices'
import type { AppendBody } from './record/append-drafts'
import type { SessionRecord } from './record/record-adapter'
import type { PrepareResult } from './ports'
import { setupWarningText } from './setup-warning'

type Prepared = Extract<PrepareResult, { ok: true }>

const warningDraftsOf = (warnings: readonly string[]): AppendBody[] =>
  warnings.length === 0
    ? []
    : [{ type: 'sandbox-setup-reported', text: setupWarningText(warnings), failed: true }]

const preparedNoticeOf = (args: { result: Prepared; resuming: boolean }): AppendBody[] => {
  if (args.resuming) return []
  const warnings = args.result.warnings ?? []
  return [
    warnings.length === 0
      ? { type: 'workspace-prepared' }
      : { type: 'workspace-prepared', warnings: [...warnings] },
  ]
}

const preparedDraftsOf = async (args: {
  record: SessionRecord
  threadId: ThreadId
  result: Prepared
  started: readonly EventDraft[]
  resuming: boolean
}): Promise<AppendBody[]> => {
  const notices = withoutRepeatedContext({
    events: await args.record.composedEvents({ threadId: args.threadId }),
    drafts: (args.result.notices ?? []).map(bootDraftOf),
  })
  const warnings = args.result.warnings ?? []
  return [
    ...args.started,
    ...baseFactDraftsOf(args.result.bases),
    ...notices,
    ...warningDraftsOf(warnings),
    ...preparedNoticeOf({ result: args.result, resuming: args.resuming }),
  ]
}

const failedDraftsOf = (args: {
  result: Extract<PrepareResult, { ok: false }>
  inboxHead: number
  attempt: number | undefined
  lostSetup: readonly AppendBody[]
}): AppendBody[] => [
  ...args.lostSetup,
  {
    type: 'workspace-prepare-failed',
    reason: args.result.reason,
    inboxHead: args.inboxHead,
    ...attemptFieldOf(args.attempt),
  },
]

export const recordPrepare = async (args: {
  record: SessionRecord
  threadId: ThreadId
  runId: RunId
  inboxHead: number
  result: PrepareResult
  attempt: number | undefined
  resuming: boolean
  started: readonly EventDraft[]
  lostSetup: readonly AppendBody[]
}): Promise<void> => {
  if (!args.result.ok) {
    await args.record.append({
      threadId: args.threadId,
      runId: args.runId,
      drafts: failedDraftsOf({
        result: args.result,
        inboxHead: args.inboxHead,
        attempt: args.attempt,
        lostSetup: args.lostSetup,
      }),
    })
    return
  }
  const drafts = await preparedDraftsOf({
    record: args.record,
    threadId: args.threadId,
    result: args.result,
    started: args.started,
    resuming: args.resuming,
  })
  if (drafts.length === 0) return
  await args.record.append({ threadId: args.threadId, runId: args.runId, drafts })
}
