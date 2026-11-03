import { describe, expect, it } from 'bun:test'

import { ECallError, initialCalls, stepCalls, type SteppedCalls } from '../index'

const at = (epoch: number): SteppedCalls => ({ ...initialCalls({ bootId: 'b0' }), epoch })

describe('stepCalls hello', () => {
  it('refuses an epoch below the highest ever seen', () => {
    const { state, effects } = stepCalls({ state: at(7), input: { type: 'hello', epoch: 5 } })
    expect(effects.errors).toEqual([ECallError.StaleEpoch])
    expect(state.epoch).toBe(7)
  })

  it('accepts the same epoch again and raises to a higher one', () => {
    expect(stepCalls({ state: at(7), input: { type: 'hello', epoch: 7 } }).effects.errors).toEqual(
      [],
    )
    expect(stepCalls({ state: at(7), input: { type: 'hello', epoch: 9 } }).state.epoch).toBe(9)
  })
})

describe('stepCalls cancel', () => {
  const running = stepCalls({
    state: at(3),
    input: { type: 'run', key: 'k', dispatched: true, epoch: 3 },
  }).state

  it('cancels a running call at the current epoch', () => {
    const { effects } = stepCalls({ state: running, input: { type: 'cancel', key: 'k', epoch: 3 } })
    expect(effects.cancelled).toEqual(['k'])
  })

  it('refuses a stale epoch and ignores a call that is not running', () => {
    const stale = stepCalls({ state: running, input: { type: 'cancel', key: 'k', epoch: 2 } })
    expect(stale.effects).toMatchObject({ cancelled: [], errors: [ECallError.StaleEpoch] })
    const unknown = stepCalls({ state: running, input: { type: 'cancel', key: 'x', epoch: 3 } })
    expect(unknown.effects).toMatchObject({ cancelled: [], errors: [] })
  })
})
