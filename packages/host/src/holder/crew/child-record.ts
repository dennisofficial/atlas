import {
  EAgentLostCause,
  type AgentLost,
  type EAgentStatus,
  type EventDraft,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'
import { settleCrashedCalls } from '@dltech/atlas-agent'
import type { SubagentSaid, WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import { podHoldProbeOf } from '../pod-hold-probe'
import type { SessionRuntime } from '../ports'
import type { LeaseLostError, SessionRecord } from '../record/record-adapter'
import { SessionRecord as RecordAdapter } from '../record/record-adapter'
import type { CrewSender } from './child-message'

export type ChildRunArgs = {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  parentRecord: SessionRecord
  parentThreadId: ThreadId
  epoch: number
  agentType: string
  intent: string
  group?: string | undefined
  callId?: string | undefined
  groupHold?: ((draft: EventDraft) => EventDraft) | undefined
  postHold?: ((post: () => Promise<void>) => Promise<void>) | undefined
  worktree?: WorktreeEntryInfo | undefined
  signal: AbortSignal
  onLeaseLost(error: LeaseLostError): void
  saySibling(said: {
    agentId: string
    text: string
    from: CrewSender
  }): Promise<SubagentSaid | undefined>
}

export type AdoptedChildArgs = ChildRunArgs & {
  agentId: ThreadId
  spawnedAt: string
  settled?: { status: EAgentStatus; endedAt: string } | undefined
}

type RecordArgs = {
  args: ChildRunArgs
  agentId: ThreadId
  onLeaseLost(error: LeaseLostError): void
}

export const childRecordOf = (spec: RecordArgs): Promise<SessionRecord> =>
  RecordAdapter.open({
    plane: spec.args.deps.plane,
    threadId: spec.agentId,
    epoch: spec.args.epoch,
    timers: spec.args.deps.timers,
    remoteCalls: spec.args.runtime.remoteCalls,
    daemonTools: spec.args.runtime.daemonTools,
    appendRetryMs: spec.args.deps.appendRetryMs,
    onLeaseLost: spec.onLeaseLost,
    nowIso: () => new Date(spec.args.deps.timers.now()).toISOString(),
    ...(spec.args.deps.log === undefined ? {} : { log: spec.args.deps.log }),
  })

export type AdoptRecordResult = { ok: true; record: SessionRecord } | { ok: false; lost: AgentLost }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const adoptRecordOf = async (spec: RecordArgs): Promise<AdoptRecordResult> => {
  let opened: SessionRecord
  try {
    opened = await childRecordOf(spec)
  } catch (error) {
    return {
      ok: false,
      lost: { cause: EAgentLostCause.RecordUnreadable, detail: messageOf(error) },
    }
  }
  if (opened.eventCache().eventsAfter(0).length === 0)
    return {
      ok: false,
      lost: { cause: EAgentLostCause.NeverStarted, detail: 'its log holds no events' },
    }
  await settleCrashedCalls({
    record: opened,
    ids: spec.args.deps.ids,
    threadId: spec.agentId,
    effectOf: (name) => spec.args.runtime.effectOf(name),
    probe: podHoldProbeOf({ runtime: spec.args.runtime, record: opened }),
  })
  return { ok: true, record: opened }
}

export const seedWorktreeOf = (spec: {
  record: SessionRecord
  ids: IdPort
  agentId: ThreadId
  worktree: WorktreeEntryInfo
}): Promise<unknown> =>
  spec.record.append({
    threadId: spec.agentId,
    runId: spec.ids.nextRunId(),
    drafts: [
      {
        type: 'worktree-entered',
        path: spec.worktree.path,
        branch: spec.worktree.branch,
        ...(spec.worktree.base === undefined ? {} : { base: spec.worktree.base }),
        adopted: spec.worktree.adopted === true,
      },
    ],
  })
