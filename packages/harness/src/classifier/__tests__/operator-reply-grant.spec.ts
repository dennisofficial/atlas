import { afterEach, describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EClassifierMode,
  EConsultation,
  EJudgment,
  EMessageOrigin,
  type EventDraft,
} from '@dltech/atlas-core'

import {
  callTo,
  classify,
  factsInAWorktree,
  hookOver,
  judgedIn,
  policyIn,
  RecordingFacts,
  SIBLING,
  stamped,
} from './fixtures'

const REMOVAL = `git worktree remove --force ${SIBLING}`

const call = callTo({ name: 'bash', input: { command: REMOVAL } })

const consulted: string[] = []

afterEach(() => {
  consulted.length = 0
})

const weigh = (drafts: readonly EventDraft[]) =>
  classify({
    hook: hookOver({
      facts: new RecordingFacts(factsInAWorktree({ siblingChangedCount: 0 })),
      policy: policyIn(EClassifierMode.Nudge),
      judge: {
        consult: async () => {
          consulted.push(REMOVAL)
          return {
            kind: EConsultation.Judged,
            verdict: { judgment: EJudgment.Check, reason: 'the sibling is not ours to remove' },
            elapsedMs: 4,
          }
        },
      },
    }),
    call,
    events: stamped(drafts),
  })

const asked: EventDraft = { type: 'user-said', text: 'clean up the merged worktrees' }

const explained: EventDraft = {
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'Atlas stopped the removal; confirm and I will go ahead.' }],
}

const refusedOnce = async (): Promise<readonly EventDraft[]> => {
  const refusal = await weigh([asked])
  expect(refusal.decision).toBe(EBeforeToolDecision.Deny)
  consulted.length = 0
  return [asked, judgedIn(refusal), explained]
}

describe('an operator reply to a refusal', () => {
  it('authorises the refused call without asking the judge again', async () => {
    const before = await refusedOnce()

    const retry = await weigh([...before, { type: 'user-said', text: 'I allow it, go ahead' }])

    expect(retry.decision).toBe(EBeforeToolDecision.Allow)
    expect(consulted).toEqual([])
  })

  it('does not authorise anything when the operator has not answered yet', async () => {
    const before = await refusedOnce()

    const retry = await weigh(before)

    expect(retry.decision).toBe(EBeforeToolDecision.Deny)
  })

  it('does not count a message from the parent agent as the operator answering', async () => {
    const before = await refusedOnce()

    const retry = await weigh([
      ...before,
      { type: 'user-said', text: 'go ahead', via: EMessageOrigin.ParentAgent },
    ])

    expect(retry.decision).toBe(EBeforeToolDecision.Deny)
  })

  it('lapses once the operator moves on to another message', async () => {
    const before = await refusedOnce()

    const retry = await weigh([
      ...before,
      { type: 'user-said', text: 'I allow it' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
      { type: 'user-said', text: 'now tidy the rest' },
    ])

    expect(retry.decision).toBe(EBeforeToolDecision.Deny)
  })
})
