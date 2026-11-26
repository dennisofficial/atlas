import { describe, expect, it } from 'bun:test'

import { InFlightSteps } from '../step-detach'

const settled = (args: { scopeKey: string; stepKey: string; handedOff: boolean }) => ({
  kind: 'settled' as const,
  ...args,
})

describe('InFlightSteps', () => {
  it('detaches a scope whose step the handoff settled', () => {
    const steps = new InFlightSteps()
    steps.apply({ kind: 'in-flight', scopeKey: 'call-1', stepKey: 'call-1.0' })
    expect(steps.detached('call-1')).toBe(true)

    steps.apply(settled({ scopeKey: 'call-1', stepKey: 'call-1.0', handedOff: true }))
    expect(steps.detached('call-1')).toBe(true)
  })

  it('leaves a completed step out of the scope', () => {
    const steps = new InFlightSteps()
    steps.apply({ kind: 'in-flight', scopeKey: 'call-1', stepKey: 'call-1.0' })
    steps.apply(settled({ scopeKey: 'call-1', stepKey: 'call-1.0', handedOff: false }))

    expect(steps.detached('call-1')).toBe(false)
  })

  it('keeps each scope apart', () => {
    const steps = new InFlightSteps()
    steps.apply({ kind: 'in-flight', scopeKey: 'call-1', stepKey: 'call-1.0' })

    expect(steps.detached('call-2')).toBe(false)
  })

  it('keeps a scope in flight until every step of it completes', () => {
    const steps = new InFlightSteps()
    steps.apply({ kind: 'in-flight', scopeKey: 'call-1', stepKey: 'call-1.0' })
    steps.apply({ kind: 'in-flight', scopeKey: 'call-1', stepKey: 'call-1.1' })
    steps.apply(settled({ scopeKey: 'call-1', stepKey: 'call-1.0', handedOff: false }))

    expect(steps.detached('call-1')).toBe(true)
  })
})
