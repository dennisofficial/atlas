import { describe, expect, it } from 'bun:test'

import { translateAnswers, translateQuestions } from '../openai-decisions'

describe('translateQuestions', () => {
  it('maps noul to predicate', () => {
    const wire = translateQuestions({
      questions: {
        concern: { type: 'noul', instructions: 'Is this a violation?' },
      },
    })
    expect(wire).toEqual([{ type: 'predicate', name: 'concern', instructions: 'Is this a violation?' }])
  })

  it('maps choice criteria to choices with descriptions', () => {
    const wire = translateQuestions({
      questions: {
        impact: {
          type: 'choice',
          instructions: 'What happened?',
          criteria: { introduced: 'New mix.', unchanged: 'No change.' },
        },
      },
    })
    expect(wire).toEqual([
      {
        type: 'choice',
        name: 'impact',
        instructions: 'What happened?',
        choices: [
          { value: 'introduced', description: 'New mix.' },
          { value: 'unchanged', description: 'No change.' },
        ],
      },
    ])
  })

  it('maps score criteria to ordered levels', () => {
    const wire = translateQuestions({
      questions: {
        severity: { type: 'score', instructions: 'How bad?', criteria: ['low', 'high'] },
      },
    })
    expect(wire).toEqual([
      { type: 'score', name: 'severity', instructions: 'How bad?', levels: [{ label: 'low' }, { label: 'high' }] },
    ])
  })
})

describe('translateAnswers', () => {
  it('maps predicate probability to noul', () => {
    const answers = translateAnswers({ answers: [{ type: 'predicate', name: 'concern', probability: 0.87 }] })
    expect(answers).toEqual({ concern: { noul: 0.87 } })
  })

  it('maps choice with probabilities and confidence', () => {
    const answers = translateAnswers({
      answers: [
        {
          type: 'choice',
          name: 'impact',
          choice: 'introduced',
          probabilities: [
            { value: 'introduced', probability: 0.8 },
            { value: 'unchanged', probability: 0.2 },
          ],
          confidence: 0.78,
        },
      ],
    })
    expect(answers).toEqual({
      impact: { choice: 'introduced', probabilities: { introduced: 0.8, unchanged: 0.2 }, confidence: 0.78 },
    })
  })

  it('skips refusals', () => {
    const answers = translateAnswers({ answers: [{ type: 'refusal', name: 'focus' }] })
    expect(answers).toEqual({})
  })

  it('maps score with confidence', () => {
    const answers = translateAnswers({ answers: [{ type: 'score', name: 'severity', score: 1.4, confidence: 0.6 }] })
    expect(answers).toEqual({ severity: { score: 1.4, confidence: 0.6 } })
  })
})
