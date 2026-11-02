import type { EventDraft, IdPort, ThreadId } from '@dltech/atlas-core'

import type { AgentIntake } from '../intake/agent-intake'
import type { AgentRecordPort } from '../record/agent-record.port'

export type PendingDrain = {
  drafts: readonly EventDraft[]
  wakesTurn: boolean
  acknowledge?: (() => void) | undefined
  release?: (() => void) | undefined
}

export type DrainedPending =
  | { ok: false; cause: unknown }
  | { ok: true; drained: boolean; wakesTurn: boolean }

export async function appendPending({
  intake,
  record,
  ids,
  threadId,
  signal,
}: {
  intake: AgentIntake | undefined
  record: AgentRecordPort
  ids: IdPort
  threadId: ThreadId
  signal?: AbortSignal | undefined
}): Promise<DrainedPending> {
  if (intake === undefined) return { ok: true, drained: false, wakesTurn: false }

  let waiting: PendingDrain
  try {
    signal?.throwIfAborted()
    waiting = await intake.prepare({ threadId, ...(signal === undefined ? {} : { signal }) })
  } catch (cause) {
    return { ok: false, cause }
  }
  if (signal?.aborted === true) {
    waiting.release?.()
    return { ok: false, cause: signal.reason }
  }

  if (waiting.drafts.length > 0) {
    try {
      await record.append({ threadId, runId: ids.nextRunId(), drafts: waiting.drafts })
    } catch (cause) {
      waiting.release?.()
      return { ok: false, cause }
    }
  }

  waiting.acknowledge?.()
  return { ok: true, drained: waiting.drafts.length > 0, wakesTurn: waiting.wakesTurn }
}
