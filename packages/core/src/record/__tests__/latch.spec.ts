import { describe, expect, it } from 'bun:test'

import type { V2Event } from '../event'
import { firedLatchLevelOf, latchFactOf, latchStepOf } from '../latch'

const factEvent = (args: { name: string; level: number; seq: number }): V2Event =>
  ({ ...latchFactOf(args), id: `e${args.seq}`, seq: args.seq }) as unknown as V2Event

describe('latchStepOf', () => {
  it('fires once when the level first rises above zero', () => {
    expect(latchStepOf({ fired: 0, level: 1, mayFire: true })).toEqual({ fire: true, record: 1 })
    expect(latchStepOf({ fired: 1, level: 1, mayFire: true })).toEqual({
      fire: false,
      record: undefined,
    })
  })

  it('fires again when the level crosses a higher threshold', () => {
    expect(latchStepOf({ fired: 1, level: 2, mayFire: true })).toEqual({ fire: true, record: 2 })
  })

  it('stays quiet when the level drops but stays above zero', () => {
    expect(latchStepOf({ fired: 2, level: 1, mayFire: true })).toEqual({
      fire: false,
      record: undefined,
    })
  })

  it('re-arms only when the level drops to zero', () => {
    expect(latchStepOf({ fired: 2, level: 0, mayFire: true })).toEqual({ fire: false, record: 0 })
    expect(latchStepOf({ fired: 0, level: 0, mayFire: true })).toEqual({
      fire: false,
      record: undefined,
    })
  })

  it('re-arms but never fires when firing is not allowed', () => {
    expect(latchStepOf({ fired: 0, level: 2, mayFire: false })).toEqual({
      fire: false,
      record: undefined,
    })
    expect(latchStepOf({ fired: 2, level: 0, mayFire: false })).toEqual({ fire: false, record: 0 })
  })
})

describe('firedLatchLevelOf', () => {
  it('reads the last recorded level of the named latch', () => {
    const events = [
      factEvent({ name: 'a', level: 2, seq: 1 }),
      factEvent({ name: 'b', level: 1, seq: 2 }),
      factEvent({ name: 'a', level: 0, seq: 3 }),
      factEvent({ name: 'a', level: 1, seq: 4 }),
    ]
    expect(firedLatchLevelOf({ events, name: 'a' })).toBe(1)
    expect(firedLatchLevelOf({ events, name: 'b' })).toBe(1)
    expect(firedLatchLevelOf({ events, name: 'c' })).toBe(0)
  })
})
