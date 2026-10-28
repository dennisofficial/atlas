import { afterEach, describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EClassifierMode,
  EConsultation,
  EJudgment,
  EToolEffect,
  toCallId,
  toThreadId,
  type ToolCall,
} from '@dltech/atlas-core'

import { ExitWorktreeTool } from '../../tools/builtin/exit-worktree'
import {
  classify,
  factsInAWorktree,
  hookOver,
  policyIn,
  RecordingFacts,
  REPO,
  TOOLS,
} from './fixtures'

const consulted: string[] = []

afterEach(() => {
  consulted.length = 0
})

const exitTool = new ExitWorktreeTool(REPO)

const exiting = (input: unknown): ToolCall => ({
  callId: toCallId('call-1'),
  name: exitTool.name,
  input,
  effect: EToolEffect.Destructive,
  threadId: toThreadId('thread-1'),
})

const weigh = (input: unknown) =>
  classify({
    hook: hookOver({
      tools: [...TOOLS, exitTool],
      facts: new RecordingFacts(factsInAWorktree()),
      policy: policyIn(EClassifierMode.Nudge),
      judge: {
        consult: async () => {
          consulted.push(JSON.stringify(input))
          return {
            kind: EConsultation.Judged,
            verdict: { judgment: EJudgment.Check, reason: 'irreversibility: worktree is lost' },
            elapsedMs: 1,
          }
        },
      },
    }),
    call: exiting(input),
  })

describe('leaving a worktree', () => {
  it('lets keep through without asking the judge, since it touches nothing on disk', async () => {
    const outcome = await weigh({ action: 'keep' })

    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    expect(consulted).toEqual([])
  })

  it('lets an unforced remove of its own worktree through, since git refuses to lose work', async () => {
    const outcome = await weigh({ action: 'remove' })

    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    expect(consulted).toEqual([])
  })

  it('still asks the judge before discarding the uncommitted changes of its worktree', async () => {
    const outcome = await weigh({ action: 'remove', discardChanges: true })

    expect(outcome.decision).toBe(EBeforeToolDecision.Deny)
    expect(consulted).toHaveLength(1)
  })
})
