import { describe, expect, it } from 'bun:test'

import { planStep, type StepFact } from '../steps'

const fact = (args: { key: string; op: string; digest: string }): StepFact => args

const plan = (args: {
  recorded?: readonly StepFact[]
  consumed?: readonly string[]
  op: string
  digest: string
  nextSlot?: number
}) =>
  planStep({
    scopeKey: 'call-1',
    recorded: args.recorded ?? [],
    consumed: new Set(args.consumed ?? []),
    op: args.op,
    digest: args.digest,
    nextSlot: args.nextSlot ?? 0,
  })

describe('planStep', () => {
  it('appends the first step of a fresh execution at index zero', () => {
    expect(plan({ op: 'services.start', digest: 'd1' })).toEqual({
      kind: 'append',
      key: 'call-1.0',
      index: 0,
    })
  })

  it('reuses a recorded step whose op and digest match', () => {
    const recorded = [fact({ key: 'call-1.0', op: 'services.start', digest: 'd1' })]
    expect(plan({ recorded, op: 'services.start', digest: 'd1' })).toEqual({
      kind: 'reuse',
      key: 'call-1.0',
      index: 0,
    })
  })

  it('never attaches a step to a different digest at the same position', () => {
    const recorded = [fact({ key: 'call-1.0', op: 'services.start', digest: 'db' })]
    expect(plan({ recorded, op: 'services.start', digest: 'api' })).toEqual({
      kind: 'append',
      key: 'call-1.1',
      index: 1,
    })
  })

  it('never attaches a step to a different op at the same position', () => {
    const recorded = [fact({ key: 'call-1.0', op: 'services.start', digest: 'd1' })]
    expect(plan({ recorded, op: 'services.stop', digest: 'd1' })).toEqual({
      kind: 'append',
      key: 'call-1.1',
      index: 1,
    })
  })

  it('gives two identical ops in one execution two slots', () => {
    const first = plan({ op: 'exec', digest: 'same' })
    const second = plan({ op: 'exec', digest: 'same', nextSlot: 1 })
    expect(first).toEqual({ kind: 'append', key: 'call-1.0', index: 0 })
    expect(second).toEqual({ kind: 'append', key: 'call-1.1', index: 1 })
  })

  it('reuses two identical recorded ops in the order they were recorded', () => {
    const recorded = [
      fact({ key: 'call-1.0', op: 'exec', digest: 'same' }),
      fact({ key: 'call-1.1', op: 'exec', digest: 'same' }),
    ]
    const first = plan({ recorded, op: 'exec', digest: 'same' })
    const second = plan({ recorded, op: 'exec', digest: 'same', consumed: ['call-1.0'] })
    expect(first.key).toBe('call-1.0')
    expect(second.key).toBe('call-1.1')
  })

  it('skips a key this execution already claimed', () => {
    const recorded = [fact({ key: 'call-1.0', op: 'exec', digest: 'same' })]
    expect(plan({ recorded, consumed: ['call-1.0'], op: 'exec', digest: 'same' })).toEqual({
      kind: 'append',
      key: 'call-1.1',
      index: 1,
    })
  })

  it('keeps the slot of a key allocated to another kind of step', () => {
    expect(plan({ op: 'exec', digest: 'd1', nextSlot: 3 })).toEqual({
      kind: 'append',
      key: 'call-1.3',
      index: 3,
    })
  })

  it('reads the index from the key, not from the position in the log', () => {
    const recorded = [fact({ key: 'call-1.4', op: 'exec', digest: 'd1' })]
    expect(plan({ recorded, op: 'exec', digest: 'd1' }).index).toBe(4)
    expect(plan({ recorded, op: 'exec', digest: 'd2' }).index).toBe(5)
  })
})
