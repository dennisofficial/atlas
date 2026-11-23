import { EClassifierFault, type ClassifierQuestion } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { decisionsAnswersOf, decisionsRequestOf, jevAnswersOf, jevRequestOf } from '../translate'

const NOUL: ClassifierQuestion = { type: 'noul', instructions: 'Is this risky?' }

const CHOICE: ClassifierQuestion = {
  type: 'choice',
  instructions: 'Which step repeats?',
  criteria: { '1': 'read the file', '2': 'read the file again' },
}

describe('jevRequestOf', () => {
  it('carries a noul question as its own kind', () => {
    expect(jevRequestOf({ questions: { danger: NOUL } })).toEqual({
      danger: { type: 'noul', instructions: 'Is this risky?' },
    })
  })

  it('carries every choice option', () => {
    expect(jevRequestOf({ questions: { loop: CHOICE } })).toEqual({
      loop: {
        type: 'choice',
        instructions: 'Which step repeats?',
        criteria: { '1': 'read the file', '2': 'read the file again' },
      },
    })
  })
})

describe('decisionsRequestOf', () => {
  it('speaks predicate for noul and choice for choice', () => {
    expect(decisionsRequestOf({ questions: { danger: NOUL, loop: CHOICE } })).toEqual([
      { type: 'predicate', name: 'danger', instructions: 'Is this risky?' },
      {
        type: 'choice',
        name: 'loop',
        instructions: 'Which step repeats?',
        choices: [
          { value: '1', description: 'read the file' },
          { value: '2', description: 'read the file again' },
        ],
      },
    ])
  })
})

describe('jevAnswersOf', () => {
  it('keeps a noul probability as it arrived', () => {
    const translated = jevAnswersOf({
      questions: { danger: NOUL },
      body: { answers: { danger: { noul: 0.87 } }, model: 'jev-latest' },
    })

    expect(translated).toEqual({ ok: true, answers: { danger: { noul: 0.87 } } })
  })

  it('keeps choice, confidence and probabilities for a choice answer', () => {
    const translated = jevAnswersOf({
      questions: { loop: CHOICE },
      body: {
        answers: {
          loop: { choice: '2', confidence: 0.9, probabilities: { '1': 0.1, '2': 0.9 } },
        },
      },
    })

    expect(translated).toEqual({
      ok: true,
      answers: { loop: { choice: '2', confidence: 0.9, probabilities: { '1': 0.1, '2': 0.9 } } },
    })
  })

  it('answers Malformed when a question has no answer', () => {
    const translated = jevAnswersOf({
      questions: { danger: NOUL },
      body: { answers: {} },
    })

    expect(translated).toMatchObject({ ok: false, fault: EClassifierFault.Malformed })
  })

  it('answers Malformed when a noul question arrives without its probability', () => {
    const translated = jevAnswersOf({
      questions: { danger: NOUL },
      body: { answers: { danger: {} } },
    })

    expect(translated).toMatchObject({ ok: false, fault: EClassifierFault.Malformed })
  })

  it('answers Malformed when the body is not an object with answers', () => {
    expect(jevAnswersOf({ questions: { danger: NOUL }, body: 'nope' })).toMatchObject({
      ok: false,
      fault: EClassifierFault.Malformed,
    })
  })
})

describe('decisionsAnswersOf', () => {
  it('keys answers by name when they arrive out of order', () => {
    const translated = decisionsAnswersOf({
      questions: { danger: NOUL, loop: CHOICE },
      body: {
        answers: [
          { type: 'choice', name: 'loop', choice: '2', probabilities: [] },
          { type: 'predicate', name: 'danger', probability: 0.4 },
        ],
      },
    })

    expect(translated).toEqual({
      ok: true,
      answers: { danger: { noul: 0.4 }, loop: { choice: '2' } },
    })
  })

  it('answers Rejected naming the question when the model refuses', () => {
    const translated = decisionsAnswersOf({
      questions: { danger: NOUL },
      body: { answers: [{ type: 'refusal', name: 'danger' }] },
    })

    expect(translated).toMatchObject({ ok: false, fault: EClassifierFault.Rejected })
    expect(translated.ok ? '' : translated.detail).toContain('danger')
  })

  it('answers Malformed when an answer is missing', () => {
    const translated = decisionsAnswersOf({
      questions: { danger: NOUL, loop: CHOICE },
      body: { answers: [{ type: 'predicate', name: 'danger', probability: 0.4 }] },
    })

    expect(translated).toMatchObject({ ok: false, fault: EClassifierFault.Malformed })
  })

  it('answers Malformed when the body does not parse', () => {
    expect(decisionsAnswersOf({ questions: { danger: NOUL }, body: {} })).toMatchObject({
      ok: false,
      fault: EClassifierFault.Malformed,
    })
  })
})
