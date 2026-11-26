import {
  EAgentRestart,
  EAgentStart,
  EAgentStatus,
  EKilledBy,
  EModelFallbackReason,
  type EventDraft,
  type ModelRef,
  type RecordBody,
  type RunFailure,
  type ThreadId,
} from '@dltech/atlas-core'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import type { RoleModelChoice, SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'
import { worktreeDraftOf, type Progress } from './child-progress'
import {
  appendOnParent,
  endingKeyOf,
  postNotice,
  reportKeyOf,
  type ChildParent,
} from './child-reports'
import { modelFellBackDraft } from './model-fell-back'

type ChildFallback = {
  from: ModelRef
  to: ModelRef
  reason: EModelFallbackReason
}

export const SPAWNED_FACT_KIND = 'agent-spawned'

export type ChildTranscriptArgs = {
  deps: HeldSessionDeps
  runtime: Pick<SessionRuntime, 'modelLabelOf'>
  model: RoleModelChoice
  parentRecord: SessionRecord
  parentThreadId: ThreadId
  agentId: ThreadId
  agentType: string
  intent: string
  group: string | undefined
  lastSeq(): number
}

export class ChildTranscript {
  constructor(private readonly args: ChildTranscriptArgs) {}

  get parent(): ChildParent {
    return {
      deps: this.args.deps,
      record: this.args.parentRecord,
      threadId: this.args.parentThreadId,
      agentId: this.args.agentId,
      agentType: this.args.agentType,
      intent: this.args.intent,
    }
  }

  async spawned(args: {
    worktree: WorktreeEntryInfo | undefined
    callId?: string | undefined
    stepKey?: string | undefined
  }): Promise<void> {
    const key = args.stepKey === undefined ? undefined : `${args.stepKey}:spawned`
    if (key !== undefined && this.spawnedBefore(key)) return
    await this.append([
      {
        type: 'agent-spawned',
        agentId: this.args.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        mode: EAgentStart.Fresh,
        ...(this.args.group === undefined ? {} : { group: this.args.group }),
        ...(args.callId === undefined ? {} : { callId: args.callId }),
        ...(args.worktree === undefined ? {} : { worktree: worktreeDraftOf(args.worktree) }),
      },
      ...this.unavailableDrafts(),
      ...(key === undefined
        ? []
        : [
            {
              type: 'fact-recorded' as const,
              key,
              kind: SPAWNED_FACT_KIND,
              value: { agentId: this.args.agentId },
            },
          ]),
    ])
  }

  private spawnedBefore(key: string): boolean {
    return this.args.parentRecord.eventCache().bookkeeping().fact(key).found
  }

  async restarted(args: { via: EAgentRestart }): Promise<void> {
    await this.append([
      {
        type: 'agent-restarted',
        agentId: this.args.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        via: args.via,
      },
    ])
  }

  async fellBack(args: { from: ModelRef; to: ModelRef }): Promise<void> {
    await this.append([
      this.fellBackDraft({ ...args, reason: EModelFallbackReason.CredentialFailed }),
    ])
  }

  async reported(args: { text: string; clientId?: string | undefined }): Promise<void> {
    await postNotice(this.parent, {
      event: {
        type: 'agent-reported',
        agentId: this.args.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        prose: args.text,
      },
      key: args.clientId ?? reportKeyOf({ agentId: this.args.agentId, seq: this.args.lastSeq() }),
    })
  }

  async ended(args: { draft: EventDraft }): Promise<void> {
    await postNotice(this.parent, {
      event: args.draft,
      key: endingKeyOf({ agentId: this.args.agentId, seq: this.args.lastSeq() }),
    })
  }

  endingDraft(args: {
    progress: Progress
    status: EAgentStatus
    failure: string | undefined
    runFailure?: RunFailure | undefined
    killedBy: EKilledBy | undefined
  }): EventDraft {
    return {
      type: 'agent-ended',
      agentId: this.args.agentId,
      agentType: this.args.agentType,
      intent: this.args.intent,
      status: args.status,
      prose: args.progress.prose,
      turns: args.progress.turns,
      toolCalls: args.progress.toolCalls,
      ...(args.killedBy === undefined ? {} : { killedBy: args.killedBy }),
      ...(args.failure === undefined ? {} : { failureCause: args.failure }),
      ...(args.runFailure === undefined
        ? {}
        : { failure: args.runFailure, failureKind: args.runFailure.kind }),
    }
  }

  private unavailableDrafts(): readonly EventDraft[] {
    const unavailable = this.args.model.unavailable
    if (unavailable === undefined) return []
    return [
      this.fellBackDraft({
        from: unavailable,
        to: this.args.model.ref,
        reason: EModelFallbackReason.ProviderNotConnected,
      }),
    ]
  }

  private fellBackDraft(args: ChildFallback): EventDraft {
    return modelFellBackDraft({
      runtime: this.args.runtime,
      role: this.args.agentType,
      agentId: this.args.agentId,
      ...args,
    })
  }

  private async append(drafts: readonly (EventDraft | RecordBody)[]): Promise<void> {
    await appendOnParent(this.parent, drafts)
  }
}
