import { describe, expect, it } from 'bun:test'

import {
  DecisionPort,
  EConsultation,
  EJudgment,
  type Brief,
  type DecisionOutcome,
} from '@dltech/atlas-core'

import { JevJudge } from '../jev-judge'

const BRIEF: Brief = {
  system: 'you are a second pair of eyes',
  prompt: 'the call about to run',
  targets: ['worktree:eng-412-sidebar'],
}

class FakeDecisions extends DecisionPort {
  constructor(private readonly outcome: DecisionOutcome) {
    super()
  }
  async decide(): Promise<DecisionOutcome> {
    return this.outcome
  }
}

const noul = (value: number): DecisionOutcome => ({
  ok: true,
  answers: { danger: { noul: value } },
})

const consult = (judge: JevJudge) =>
  judge.consult({ brief: BRIEF, signal: AbortSignal.timeout(1000) })

describe('JevJudge', () => {
  it('proceeds when the probability is under the threshold', async () => {
    const consultation = await consult(new JevJudge({ decisions: new FakeDecisions(noul(0.11)) }))
    expect(consultation.kind).toBe(EConsultation.Judged)
    if (consultation.kind !== EConsultation.Judged) return
    expect(consultation.verdict.judgment).toBe(EJudgment.Proceed)
    expect(consultation.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('checks when the probability crosses the threshold, naming a target', async () => {
    const consultation = await consult(new JevJudge({ decisions: new FakeDecisions(noul(0.72)) }))
    if (consultation.kind !== EConsultation.Judged) throw new Error('expected a verdict')
    expect(consultation.verdict.judgment).toBe(EJudgment.Check)
    expect(consultation.verdict.reason).toContain('worktree:eng-412-sidebar')
  })

  it('is unreachable when the client fails', async () => {
    const consultation = await consult(
      new JevJudge({ decisions: new FakeDecisions({ ok: false, fault: 'answered 502' }) }),
    )
    expect(consultation.kind).toBe(EConsultation.Unreachable)
    if (consultation.kind !== EConsultation.Unreachable) return
    expect(consultation.fault).toContain('502')
  })

  it('is unreachable when the answer lacks a risk probability', async () => {
    const consultation = await consult(
      new JevJudge({ decisions: new FakeDecisions({ ok: true, answers: {} }) }),
    )
    expect(consultation.kind).toBe(EConsultation.Unreachable)
  })
})
