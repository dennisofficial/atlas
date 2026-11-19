import { EToolEffect, type EAgentStatus, type IdPort, type ThreadId } from '@dltech/atlas-core'
import { settleCrashedCalls } from '@dltech/atlas-agent'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRuntime } from '../ports'
import type { LeaseLostError, SessionRecord } from '../record/record-adapter'
import { SessionRecord as RecordAdapter } from '../record/record-adapter'

export type ChildRunArgs = {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  parentRecord: SessionRecord
  parentThreadId: ThreadId
  epoch: number
  agentType: string
  intent: string
  worktree?: WorktreeEntryInfo | undefined
  signal: AbortSignal
  onLeaseLost(error: LeaseLostError): void
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

export const adoptRecordOf = async (spec: RecordArgs): Promise<SessionRecord | undefined> => {
  const opened = await childRecordOf(spec).catch(() => undefined)
  if (opened === undefined || opened.eventCache().eventsAfter(0).length === 0) return undefined
  await settleCrashedCalls({
    record: opened,
    ids: spec.args.deps.ids,
    threadId: spec.agentId,
    effectOf: (name) =>
      spec.args.runtime.daemonTools.has(name) ? EToolEffect.Read : spec.args.runtime.effectOf(name),
  })
  return opened
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
