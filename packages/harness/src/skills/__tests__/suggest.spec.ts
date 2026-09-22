import { describe, expect, it } from 'bun:test'

import {
  DecisionPort,
  SKILL_SUGGEST_WHICH_KEY,
  type DecisionOutcome,
  type DecisionQuestion,
  type SkillSuggestionCandidate,
} from '@dltech/atlas-core'

import { suggestSkill } from '../suggest'

class ScriptedDecisions extends DecisionPort {
  readonly states: string[] = []
  private readonly outcomes: DecisionOutcome[]

  constructor(outcomes: readonly DecisionOutcome[]) {
    super()
    this.outcomes = [...outcomes]
  }

  async decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
  }): Promise<DecisionOutcome> {
    this.states.push(args.state)
    const next = this.outcomes.shift()
    if (next === undefined) throw new Error('unexpected decide call')
    return next
  }
}

const candidate = (name: string): SkillSuggestionCandidate => ({
  name,
  description: `${name} description`,
  whenToUse: undefined,
  body: `${name} body`,
})

const CANDIDATES = [candidate('alpha'), candidate('beta'), candidate('gamma')]

const SIGNAL = new AbortController().signal

const wideOutcome = (gate: number): DecisionOutcome => ({
  ok: true,
  answers: {
    [SKILL_SUGGEST_WHICH_KEY]: {
      choice: 'beta',
      probabilities: { alpha: 0.1, beta: 0.6, gamma: 0.3 },
    },
    'gate::acts_on_user_system': { noul: gate },
    'gate::would_follow_documented_procedure': { noul: gate },
    'gate::prose_suffices': { noul: 1 - gate },
  },
})

const rerankOutcome = (choice: string, fits: number): DecisionOutcome => ({
  ok: true,
  answers: {
    [SKILL_SUGGEST_WHICH_KEY]: { choice },
    'fits::beta': { noul: fits },
    'fits::gamma': { noul: fits / 2 },
    'fits::alpha': { noul: fits / 4 },
  },
})

describe('suggestSkill', () => {
  it('names nobody when the roster is empty, without calling the model', async () => {
    const decisions = new ScriptedDecisions([])
    const suggestion = await suggestSkill({ decisions, candidates: [], request: 'hi', signal: SIGNAL })
    expect(suggestion).toEqual({ ok: true, name: undefined })
    expect(decisions.states).toHaveLength(0)
  })

  it('stops after the wide call when the gate says no skill is wanted', async () => {
    const decisions = new ScriptedDecisions([wideOutcome(0.1)])
    const suggestion = await suggestSkill({
      decisions,
      candidates: CANDIDATES,
      request: 'what is a monad?',
      signal: SIGNAL,
    })
    expect(suggestion).toEqual({ ok: true, name: undefined })
    expect(decisions.states).toHaveLength(1)
  })

  it('reranks the shortlist and returns the winner', async () => {
    const decisions = new ScriptedDecisions([wideOutcome(0.8), rerankOutcome('gamma', 0.7)])
    const suggestion = await suggestSkill({
      decisions,
      candidates: CANDIDATES,
      request: 'build me a pitch deck',
      signal: SIGNAL,
    })
    expect(suggestion).toEqual({ ok: true, name: 'gamma' })
    expect(decisions.states).toHaveLength(2)
  })

  it('suggests nothing when every fits noul lands under the threshold', async () => {
    const decisions = new ScriptedDecisions([wideOutcome(0.8), rerankOutcome('beta', 0.2)])
    const suggestion = await suggestSkill({
      decisions,
      candidates: CANDIDATES,
      request: 'post this to mastodon',
      signal: SIGNAL,
    })
    expect(suggestion).toEqual({ ok: true, name: undefined })
  })

  it('is unavailable when the wide call faults', async () => {
    const decisions = new ScriptedDecisions([{ ok: false, fault: 'decisions.url is not set' }])
    const suggestion = await suggestSkill({
      decisions,
      candidates: CANDIDATES,
      request: 'build me a pitch deck',
      signal: SIGNAL,
    })
    expect(suggestion.ok).toBe(false)
  })

  it('is unavailable when the rerank call faults', async () => {
    const decisions = new ScriptedDecisions([wideOutcome(0.8), { ok: false, fault: 'overloaded' }])
    const suggestion = await suggestSkill({
      decisions,
      candidates: CANDIDATES,
      request: 'build me a pitch deck',
      signal: SIGNAL,
    })
    expect(suggestion.ok).toBe(false)
  })

  it('is unavailable when the gate answers are missing from an otherwise fine reply', async () => {
    const decisions = new ScriptedDecisions([
      { ok: true, answers: { [SKILL_SUGGEST_WHICH_KEY]: { choice: 'beta' } } },
    ])
    const suggestion = await suggestSkill({
      decisions,
      candidates: CANDIDATES,
      request: 'build me a pitch deck',
      signal: SIGNAL,
    })
    expect(suggestion.ok).toBe(false)
  })

  it('caps the request text sent as state', async () => {
    const decisions = new ScriptedDecisions([wideOutcome(0.1)])
    await suggestSkill({
      decisions,
      candidates: CANDIDATES,
      request: 'x'.repeat(10_000),
      signal: SIGNAL,
    })
    expect(decisions.states[0]?.length).toBe(4_000)
  })
})
