import { describe, expect, it } from 'bun:test'

import {
  EConsultation,
  EJudgment,
  JudgePort,
  type Brief,
  type Consultation,
} from '@dltech/atlas-core'

import { RoutedJudge } from '../routed-judge'

const BRIEF: Brief = { system: 'sys', prompt: 'the call', targets: [] }

const PROCEED: Consultation = {
  kind: EConsultation.Judged,
  verdict: { judgment: EJudgment.Proceed, reason: 'fine' },
  elapsedMs: 1,
}

class SpyJudge extends JudgePort {
  calls = 0
  async consult(): Promise<Consultation> {
    this.calls += 1
    return PROCEED
  }
}

const consult = (judge: JudgePort) =>
  judge.consult({ brief: BRIEF, signal: AbortSignal.timeout(1000) })

describe('RoutedJudge', () => {
  it('consults the fallback while the decision endpoint is unconfigured', async () => {
    const fallback = new SpyJudge()
    const jev = new SpyJudge()
    const judge = new RoutedJudge({ fallback, jev, enabled: () => false })

    await consult(judge)

    expect(fallback.calls).toBe(1)
    expect(jev.calls).toBe(0)
  })

  it('consults jev once an endpoint is configured', async () => {
    const fallback = new SpyJudge()
    const jev = new SpyJudge()
    const judge = new RoutedJudge({ fallback, jev, enabled: () => true })

    await consult(judge)

    expect(jev.calls).toBe(1)
    expect(fallback.calls).toBe(0)
  })

  it('follows the toggle live, in both directions', async () => {
    const fallback = new SpyJudge()
    const jev = new SpyJudge()
    let on = false
    const judge = new RoutedJudge({ fallback, jev, enabled: () => on })

    await consult(judge)
    on = true
    await consult(judge)
    on = false
    await consult(judge)

    expect(fallback.calls).toBe(2)
    expect(jev.calls).toBe(1)
  })
})
