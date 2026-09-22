import { describe, expect, it } from 'bun:test'

import {
  JEV_RISK_KEY,
  JEV_RISK_THRESHOLD,
  JEV_SERVICE_KEY,
  jevAnswersSchema,
  jevRiskQuestions,
  jevServiceQuestions,
  verdictFromRisk,
} from '../jev'
import { EJudgment } from '../verdict'

describe('verdictFromRisk', () => {
  it('proceeds under the threshold', () => {
    const verdict = verdictFromRisk({ probability: JEV_RISK_THRESHOLD - 0.01, targets: [] })
    expect(verdict.judgment).toBe(EJudgment.Proceed)
  })

  it('checks at the threshold', () => {
    const verdict = verdictFromRisk({ probability: JEV_RISK_THRESHOLD, targets: [] })
    expect(verdict.judgment).toBe(EJudgment.Check)
  })

  it('names a target in a check reason so the dimension can be cited', () => {
    const verdict = verdictFromRisk({ probability: 0.72, targets: ['src/index.ts'] })
    expect(verdict.judgment).toBe(EJudgment.Check)
    expect(verdict.reason).toContain('src/index.ts')
    expect(verdict.reason).toContain('0.72')
  })

  it('still reads without targets', () => {
    const verdict = verdictFromRisk({ probability: 0.9, targets: [] })
    expect(verdict.judgment).toBe(EJudgment.Check)
    expect(verdict.reason.length).toBeGreaterThan(0)
  })
})

describe('jevRiskQuestions', () => {
  it('asks exactly one noul question', () => {
    const questions = jevRiskQuestions()
    expect(Object.keys(questions)).toEqual([JEV_RISK_KEY])
    expect(questions[JEV_RISK_KEY]?.type).toBe('noul')
  })

  it('tells the model an operator’s own authorisation settles the question', () => {
    expect(jevRiskQuestions()[JEV_RISK_KEY]?.instructions).toContain(
      'authorised it in their own words',
    )
  })
})

describe('jevServiceQuestions', () => {
  it('asks exactly one noul question', () => {
    const questions = jevServiceQuestions()
    expect(Object.keys(questions)).toEqual([JEV_SERVICE_KEY])
    expect(questions[JEV_SERVICE_KEY]?.type).toBe('noul')
  })
})

describe('jevAnswersSchema', () => {
  it('reads the noul probability and tolerates the extra fields Laya sends', () => {
    const parsed = jevAnswersSchema.safeParse({
      answers: {
        [JEV_RISK_KEY]: { type: 'noul', noul: 0.82, rl_agent: { act_probability: 1 } },
      },
      usage: { input_tokens: 114, output_tokens: 0 },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.answers[JEV_RISK_KEY]?.noul).toBe(0.82)
  })

  it('rejects a probability outside 0..1', () => {
    expect(
      jevAnswersSchema.safeParse({ answers: { [JEV_RISK_KEY]: { noul: 1.4 } } }).success,
    ).toBe(false)
  })

  it('reads whichever question keys the caller asked for', () => {
    const parsed = jevAnswersSchema.safeParse({
      answers: { danger: { noul: 0.1 }, service: { noul: 0.9 } },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.answers['service']?.noul).toBe(0.9)
  })
})
