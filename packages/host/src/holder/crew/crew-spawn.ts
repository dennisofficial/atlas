import type { EventDraft, ThreadId } from '@dltech/atlas-core'
import type { SubagentSnapshot, WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import { ChildRun, type ChildRunArgs } from './child-run'
import type { ChildKey } from './child-record'
import { spawnAgentIdOf } from './spawn-key'
import { hostStepOf } from '../record/host-step'
import { scopeCallId } from '../../calls/call-scope'

export const SPAWN_OP = 'crew.spawn'

const briefKeyOf = (stepKey: string): string => `${stepKey}:brief`

const stableWorktreeOf = (
  worktree: WorktreeEntryInfo | undefined,
): Pick<WorktreeEntryInfo, 'path'> | undefined =>
  worktree === undefined ? undefined : { path: worktree.path }

export type CrewRoomArgs = Omit<
  ChildRunArgs,
  'agentType' | 'intent' | 'group' | 'groupHold' | 'saySibling' | 'key'
>

export type SpawnArgs = {
  agentType: string
  intent: string
  prompt: string
  group?: string | undefined
  worktree?: WorktreeEntryInfo | undefined
}

export type SpawnRoom = {
  args: CrewRoomArgs
  runs: Map<ThreadId, ChildRun>
  childArgs: () => Omit<ChildRunArgs, 'agentType' | 'intent'>
  holdOf: (draft: EventDraft) => EventDraft
  postInOrder: (post: () => Promise<void>) => Promise<void>
}

export class CrewSpawn {
  constructor(private readonly room: SpawnRoom) {}

  async spawn(args: SpawnArgs): Promise<SubagentSnapshot> {
    const step = await hostStepOf({
      record: this.room.args.parentRecord,
      threadId: this.room.args.parentThreadId,
      runId: () => this.room.args.deps.ids.nextRunId(),
      op: SPAWN_OP,
      input: {
        agentType: args.agentType,
        intent: args.intent,
        prompt: args.prompt,
        group: args.group,
        worktree: stableWorktreeOf(args.worktree),
      },
    })
    return step === undefined
      ? await this.spawnFresh(args)
      : await this.spawnKeyed({ args, stepKey: step.key })
  }

  private async spawnFresh(args: SpawnArgs): Promise<SubagentSnapshot> {
    const run = await ChildRun.open(this.openArgsOf({ args }))
    this.room.runs.set(run.agentId, run)
    await run.say({ text: args.prompt })
    return run.snapshot()
  }

  private async spawnKeyed(args: { args: SpawnArgs; stepKey: string }): Promise<SubagentSnapshot> {
    const agentId = spawnAgentIdOf({
      parentThreadId: this.room.args.parentThreadId,
      stepKey: args.stepKey,
    })
    const held = this.room.runs.get(agentId)
    if (held !== undefined) {
      await held.say({ text: args.args.prompt, clientId: briefKeyOf(args.stepKey) })
      return held.snapshot()
    }
    const callId = scopeCallId()
    const run = await ChildRun.open(
      this.openArgsOf({
        args: args.args,
        key: { agentId, stepKey: args.stepKey, ...(callId === undefined ? {} : { callId }) },
      }),
    )
    this.room.runs.set(run.agentId, run)
    await run.say({ text: args.args.prompt, clientId: briefKeyOf(args.stepKey) })
    await run.continueExisting()
    return run.snapshot()
  }

  private openArgsOf(open: { args: SpawnArgs; key?: ChildKey | undefined }): ChildRunArgs {
    return {
      ...this.room.childArgs(),
      agentType: open.args.agentType,
      intent: open.args.intent,
      groupHold: (draft) => this.room.holdOf(draft),
      postHold: (post) => this.room.postInOrder(post),
      ...(open.args.group === undefined ? {} : { group: open.args.group }),
      ...(open.args.worktree === undefined ? {} : { worktree: open.args.worktree }),
      ...(open.key === undefined ? {} : { key: open.key }),
    }
  }
}
