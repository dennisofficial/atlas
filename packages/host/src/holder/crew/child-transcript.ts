import {
  EAgentRestart,
  EAgentStart,
  EAgentStatus,
  EKilledBy,
  EModelFallbackReason,
  EReportKind,
  reportWakesParent,
  type EventDraft,
  type ModelRef,
  type ThreadId,
} from '@dltech/atlas-core'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'
import { childChoiceOf } from './child-model'
import { worktreeDraftOf, type Progress } from './child-progress'
import {
  appendOnParent,
  endingTextOf,
  reportTextOf,
  wakeParent,
  type ChildParent,
} from './child-reports'
import { modelFellBackDraft } from './model-fell-back'

type ChildFallback = {
  from: ModelRef
  to: ModelRef
  reason: EModelFallbackReason
}

export type ChildTranscriptArgs = {
  deps: HeldSessionDeps
  runtime: Pick<SessionRuntime, 'modelChoice' | 'choiceFor' | 'modelLabelOf'>
  parentRecord: SessionRecord
  parentThreadId: ThreadId
  agentId: ThreadId
  agentType: string
  intent: string
}

export class ChildTranscript {
  private woke = false

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

  async spawned(args: { worktree: WorktreeEntryInfo | undefined }): Promise<void> {
    await this.append([
      {
        type: 'agent-spawned',
        agentId: this.args.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        mode: EAgentStart.Fresh,
        ...(args.worktree === undefined ? {} : { worktree: worktreeDraftOf(args.worktree) }),
      },
      ...this.unavailableDrafts(),
    ])
  }

  async restarted(): Promise<void> {
    await this.append([
      {
        type: 'agent-restarted',
        agentId: this.args.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        via: EAgentRestart.Message,
      },
    ])
  }

  async fellBack(args: { from: ModelRef; to: ModelRef }): Promise<void> {
    await this.append([
      this.fellBackDraft({ ...args, reason: EModelFallbackReason.CredentialFailed }),
    ])
  }

  async reported(args: { kind: EReportKind; text: string }): Promise<void> {
    await this.append([
      {
        type: 'agent-reported',
        agentId: this.args.agentId,
        agentType: this.args.agentType,
        intent: this.args.intent,
        prose: args.text,
        kind: args.kind,
      },
    ])
    if (!reportWakesParent(args.kind)) return
    await wakeParent(this.parent, reportTextOf(this.parent, args.kind))
    this.woke = true
  }

  async ended(args: {
    progress: Progress
    status: EAgentStatus
    failure: string | undefined
    killedBy: EKilledBy | undefined
  }): Promise<void> {
    await this.append([
      {
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
      },
    ])
    if (this.woke) return
    await wakeParent(
      this.parent,
      endingTextOf({
        parent: this.parent,
        progress: args.progress,
        status: args.status,
        failure: args.failure,
        killedBy: args.killedBy,
      }),
    )
  }

  private unavailableDrafts(): readonly EventDraft[] {
    const choice = childChoiceOf({ runtime: this.args.runtime, agentType: this.args.agentType })
    if (choice.unavailable === undefined) return []
    return [
      this.fellBackDraft({
        from: choice.unavailable,
        to: choice.ref,
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

  private async append(drafts: readonly EventDraft[]): Promise<void> {
    await appendOnParent(this.parent, drafts)
  }
}
