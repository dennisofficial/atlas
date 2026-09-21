import { describe, expect, it } from 'bun:test'

import {
  EConsultation,
  EJudgment,
  JudgePort,
  type Brief,
  type Consultation,
} from '@dltech/atlas-core'

import { RoutedJudge } from '../routed-judge'
import type { JevConfig } from '../jev-judge'

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
  it('consults the fallback when no decision endpoint is configured', async () => {
    const fallback = new SpyJudge()
    const judge = new RoutedJudge({ fallback, config: () => undefined })

    await consult(judge)

    expect(fallback.calls).toBe(1)
  })

  it('consults jev when an endpoint is configured', async () => {
    const fallback = new SpyJudge()
    const jev = new SpyJudge()
    const config: JevConfig = { baseUrl: 'https://decisions.example/v1', token: 'sk' }
    const judge = new RoutedJudge({ fallback, config: () => config, makeJev: () => jev })

    await consult(judge)

    expect(jev.calls).toBe(1)
    expect(fallback.calls).toBe(0)
  })

  it('rebuilds the jev judge when the config changes', async () => {
    const made: string[] = []
    let current: JevConfig = { baseUrl: 'https://a.example', token: undefined }
    const judge = new RoutedJudge({
      fallback: new SpyJudge(),
      config: () => current,
      makeJev: (config) => {
        made.push(config.baseUrl)
        return new SpyJudge()
      },
    })

    await consult(judge)
    await consult(judge)
    current = { baseUrl: 'https://b.example', token: undefined }
    await consult(judge)

    expect(made).toEqual(['https://a.example', 'https://b.example'])
  })

  it('follows the config back to the fallback when the endpoint is cleared', async () => {
    const fallback = new SpyJudge()
    let current: JevConfig | undefined = { baseUrl: 'https://a.example', token: undefined }
    const judge = new RoutedJudge({
      fallback,
      config: () => current,
      makeJev: () => new SpyJudge(),
    })

    await consult(judge)
    current = undefined
    await consult(judge)

    expect(fallback.calls).toBe(1)
  })
})
