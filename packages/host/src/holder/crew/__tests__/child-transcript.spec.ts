import { describe, expect, it } from 'bun:test'
import {
  EAgentStart,
  EAgentStatus,
  EEffort,
  EModelFallbackReason,
  EReportKind,
  refKey,
  type EventDraft,
  type ModelChoice,
  type ThreadId,
} from '@dltech/atlas-core'

import type { HeldSessionDeps } from '../../held-session-deps'
import type { RoleModelChoice } from '../../ports'
import type { SessionRecord } from '../../record/record-adapter'
import { ChildTranscript } from '../child-transcript'

const PARENT = 'thread-parent' as ThreadId
const CHILD = 'thread-child' as ThreadId
const ROLE = 'general-purpose'

const MAIN: ModelChoice = {
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.High,
  fast: false,
}

const OTHER = { providerId: 'openai', modelId: 'gpt-5' }

const label = (ref: { providerId: string; modelId: string }): string => `${ref.modelId} label`

const transcriptOf = (
  choice: RoleModelChoice,
  posted: string[],
): { transcript: ChildTranscript; appends: EventDraft[][] } => {
  const appends: EventDraft[][] = []
  const deps = {
    sessionId: 'session-1',
    ids: { nextRunId: () => 'run-1' },
    plane: {
      post: async (message: { payload: string }) => {
        posted.push(message.payload)
      },
    },
  } as unknown as HeldSessionDeps
  const record = {
    append: async (args: { drafts: readonly EventDraft[] }) => {
      appends.push([...args.drafts])
    },
  } as unknown as SessionRecord
  const transcript = new ChildTranscript({
    deps,
    runtime: { modelChoice: MAIN, choiceFor: () => choice, modelLabelOf: label },
    parentRecord: record,
    parentThreadId: PARENT,
    agentId: CHILD,
    agentType: ROLE,
    intent: 'probe',
  })
  return { transcript, appends }
}

describe('ChildTranscript', () => {
  it('writes the fallback straight after the spawn when the child model is unavailable', async () => {
    const { transcript, appends } = transcriptOf({ ...MAIN, unavailable: OTHER }, [])
    await transcript.spawned({ worktree: undefined })
    expect(appends).toEqual([
      [
        {
          type: 'agent-spawned',
          agentId: CHILD,
          agentType: ROLE,
          intent: 'probe',
          mode: EAgentStart.Fresh,
        },
        {
          type: 'model-fell-back',
          role: ROLE,
          agentId: CHILD,
          from: { ref: refKey(OTHER), label: label(OTHER) },
          to: { ref: refKey(MAIN.ref), label: label(MAIN.ref) },
          reason: EModelFallbackReason.ProviderNotConnected,
        },
      ],
    ])
  })

  it('spawns alone when the child model is reachable', async () => {
    const { transcript, appends } = transcriptOf(MAIN, [])
    await transcript.spawned({ worktree: undefined })
    expect(appends.map((drafts) => drafts.map((draft) => draft.type))).toEqual([['agent-spawned']])
  })

  it('blames the credential when the model falls back during a turn', async () => {
    const { transcript, appends } = transcriptOf(MAIN, [])
    await transcript.fellBack({ from: OTHER, to: MAIN.ref })
    expect(appends).toEqual([
      [
        {
          type: 'model-fell-back',
          role: ROLE,
          agentId: CHILD,
          from: { ref: refKey(OTHER), label: label(OTHER) },
          to: { ref: refKey(MAIN.ref), label: label(MAIN.ref) },
          reason: EModelFallbackReason.CredentialFailed,
        },
      ],
    ])
  })

  it('wakes the parent once, when the ending follows a waking report', async () => {
    const posted: string[] = []
    const { transcript } = transcriptOf(MAIN, posted)
    await transcript.reported({ kind: EReportKind.Blocked, text: 'stuck' })
    await transcript.ended({
      progress: { turns: 1, toolCalls: 0, prose: '', lastTool: undefined },
      status: EAgentStatus.Finished,
      failure: undefined,
      killedBy: undefined,
    })
    expect(posted).toHaveLength(1)
  })
})
