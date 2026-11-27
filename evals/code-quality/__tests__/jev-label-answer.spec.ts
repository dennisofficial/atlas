import { describe, expect, test } from 'vitest'

import { EQualityImpact } from '@dltech/atlas-core'

import {
  EJevLabel,
  JevLabelAnswerError,
  parseLabelAnswer,
  resolveJevLabel,
  type JevLabelAnswer,
} from '../jev-label-answer'
import { JevLabelStateError, readScopeState, splitRequestState } from '../jev-label-state'

const stateOf = ({
  before = 'export function run() {}',
  after = 'export function run() { return 1 }',
}: {
  before?: string | null
  after?: string | null
} = {}): string =>
  JSON.stringify({
    scope: {
      before,
      after,
      diff: 'diff --git a/src/a.ts b/src/a.ts',
      dependencyContext: ['import { z } from "zod"'],
      evidence: [{ id: 'e1', label: 'responsibility', changed: true }],
    },
  })

const answerOf = ({
  label = EJevLabel.NoNudge,
  impact = EQualityImpact.Unchanged,
}: {
  label?: EJevLabel
  impact?: EQualityImpact
} = {}): JevLabelAnswer => ({
  mixes: false,
  change_reasons: ['routing'],
  impact,
  label,
  reason: 'the edit only moves a call',
})

describe('splitRequestState', () => {
  test('keeps the state before the blank line that ends it', () => {
    const state = stateOf()
    const content = `${state}\n\n{"single-responsibility:impact":{"kind":"choose"}}`
    expect(splitRequestState({ content })).toBe(state)
  })

  test('survives braces and quotes inside the recorded code', () => {
    const state = stateOf({ after: 'const x = "}{\\"" }}; if (a) { b() }' })
    const content = `${state}\n\n{}`
    const split = splitRequestState({ content })
    expect(split).toBe(state)
    expect(readScopeState({ state: split }).after).toBe('const x = "}{\\"" }}; if (a) { b() }')
  })

  test('refuses content that never separates the state from the questions', () => {
    expect(() => splitRequestState({ content: `${stateOf()} {"a":1}` })).toThrow(JevLabelStateError)
  })

  test('refuses a document that never closes', () => {
    expect(() => splitRequestState({ content: '{"scope": {' })).toThrow(JevLabelStateError)
  })
})

describe('readScopeState', () => {
  test('reads the before, after, diff and collaborators', () => {
    const scope = readScopeState({ state: stateOf({ before: null }) })
    expect(scope.before).toBeNull()
    expect(scope.dependencyContext).toEqual(['import { z } from "zod"'])
  })

  test('refuses a state without its scope fields', () => {
    expect(() => readScopeState({ state: '{"scope":{}}' })).toThrow(JevLabelStateError)
  })
})

describe('parseLabelAnswer', () => {
  test('reads the answer from surrounding text', () => {
    const answer = parseLabelAnswer({
      text: 'Here it is:\n```json\n{"mixes":true,"change_reasons":["routing"],"impact":"introduced","label":"nudge","reason":"two reasons"}\n```',
    })
    expect(answer.label).toBe(EJevLabel.Nudge)
    expect(answer.impact).toBe(EQualityImpact.Introduced)
  })

  test('refuses an answer that is not a label object', () => {
    expect(() => parseLabelAnswer({ text: 'no idea' })).toThrow(JevLabelAnswerError)
    expect(() => parseLabelAnswer({ text: '{"label":"nudge"}' })).toThrow(JevLabelAnswerError)
  })
})

describe('resolveJevLabel', () => {
  test('agrees when both models pick the same label', () => {
    const verdict = resolveJevLabel({
      answers: [answerOf(), answerOf({ impact: EQualityImpact.Improved })],
    })
    expect(verdict.agreed).toBe(true)
    expect(verdict.label).toBe(EJevLabel.NoNudge)
    expect(verdict.impact).toBe(EQualityImpact.Unchanged)
    expect(verdict.impactDisputed).toEqual([EQualityImpact.Unchanged, EQualityImpact.Improved])
  })

  test('is unsure when the models disagree on the label', () => {
    const verdict = resolveJevLabel({
      answers: [answerOf(), answerOf({ label: EJevLabel.Unsure })],
    })
    expect(verdict.agreed).toBe(false)
    expect(verdict.label).toBe(EJevLabel.Unsure)
    expect(verdict.notify).toBe(false)
  })

  test('takes introduced for a disputed nudge and unchanged for a disputed no_nudge', () => {
    const nudge = resolveJevLabel({
      answers: [
        answerOf({ label: EJevLabel.Nudge, impact: EQualityImpact.Introduced }),
        answerOf({ label: EJevLabel.Nudge, impact: EQualityImpact.Worsened }),
      ],
    })
    expect(nudge.agreed).toBe(true)
    expect(nudge.impact).toBe(EQualityImpact.Introduced)
    expect(nudge.impactDisputed).toEqual([EQualityImpact.Introduced, EQualityImpact.Worsened])
    const noNudge = resolveJevLabel({
      answers: [
        answerOf({ impact: EQualityImpact.Improved }),
        answerOf({ impact: EQualityImpact.Resolved }),
      ],
    })
    expect(noNudge.impact).toBe(EQualityImpact.Unchanged)
  })

  test('refuses an item with no answer', () => {
    expect(() => resolveJevLabel({ answers: [] })).toThrow(JevLabelAnswerError)
  })
})
