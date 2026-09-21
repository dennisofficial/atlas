import { describe, expect, it } from 'bun:test'

import {
  DecisionPort,
  EBeforeToolDecision,
  type DecisionOutcome,
  type ToolCall,
} from '@dltech/atlas-core'

import { ServiceShapeHook } from '../service-shape-hook'

class FakeDecisions extends DecisionPort {
  calls = 0
  constructor(private readonly outcome: DecisionOutcome) {
    super()
  }
  async decide(): Promise<DecisionOutcome> {
    this.calls += 1
    return this.outcome
  }
}

const bashCall = (command: string): ToolCall =>
  ({
    callId: 'call-1',
    name: 'bash',
    input: { command },
  }) as ToolCall

const run = (hook: ServiceShapeHook, call: ToolCall) =>
  hook.run({ call, projectDirectory: '/repo', events: [], signal: AbortSignal.timeout(1000) })

const noul = (value: number): DecisionOutcome => ({ ok: true, answers: { service: { noul: value } } })

describe('ServiceShapeHook', () => {
  it('allows non-bash tools without consulting', async () => {
    const decisions = new FakeDecisions(noul(0.99))
    const outcome = await run(
      new ServiceShapeHook({ decisions }),
      { callId: 'c', name: 'read', input: { path: 'x' } } as ToolCall,
    )
    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    expect(decisions.calls).toBe(0)
  })

  it('allows ordinary commands without consulting', async () => {
    const decisions = new FakeDecisions(noul(0.99))
    const outcome = await run(new ServiceShapeHook({ decisions }), bashCall('bun test'))
    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    expect(decisions.calls).toBe(0)
  })

  it('allows when decisions are unconfigured or unreachable', async () => {
    const decisions = new FakeDecisions({ ok: false, fault: 'decisions.url is not set' })
    const outcome = await run(new ServiceShapeHook({ decisions }), bashCall('bun run dev'))
    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
  })

  it('allows a server-shaped command the model calls short-lived', async () => {
    const decisions = new FakeDecisions(noul(0.1))
    const outcome = await run(new ServiceShapeHook({ decisions }), bashCall('bun run dev'))
    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    expect(decisions.calls).toBe(1)
  })

  it('denies with teaching prose when the command starts a long-lived process', async () => {
    const decisions = new FakeDecisions(noul(0.81))
    const outcome = await run(new ServiceShapeHook({ decisions }), bashCall('bun run dev'))
    expect(outcome.decision).toBe(EBeforeToolDecision.Deny)
    if (outcome.decision !== EBeforeToolDecision.Deny) return
    expect(outcome.reason).toContain('service_start')
    expect(outcome.reason).toContain('0.81')
  })
})
