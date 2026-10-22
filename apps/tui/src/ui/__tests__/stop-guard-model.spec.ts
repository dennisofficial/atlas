import { describe, expect, it } from 'bun:test'

import {
  moveStopGuardSelection,
  openStopGuard,
  resolveStopGuard,
  selectedStopGuardOption,
  type StopGuardOption,
} from '../stop-guard-model'

enum EChoice {
  First = 'first',
  Second = 'second',
  Third = 'third',
}

const OPTIONS: readonly StopGuardOption<EChoice>[] = Object.freeze([
  { choice: EChoice.First, label: 'First', enabled: true },
  { choice: EChoice.Second, label: 'Second', enabled: false, note: 'soon' },
  { choice: EChoice.Third, label: 'Third', enabled: true },
])

describe('stop guard model', () => {
  it('opens on the first enabled option', () => {
    expect(openStopGuard({ options: OPTIONS })).toEqual({ selected: 0 })
  })

  it('opens on the first option when a later one leads disabled', () => {
    const reordered: readonly StopGuardOption<EChoice>[] = [
      { choice: EChoice.Second, label: 'Second', enabled: false },
      { choice: EChoice.First, label: 'First', enabled: true },
    ]
    expect(openStopGuard({ options: reordered })).toEqual({ selected: 1 })
  })

  it('moves past disabled options', () => {
    const opened = openStopGuard({ options: OPTIONS })
    expect(moveStopGuardSelection({ options: OPTIONS, state: opened, delta: 1 })).toEqual({
      selected: 2,
    })
  })

  it('stays put when no enabled option exists in that direction', () => {
    const state = { selected: 2 }
    expect(moveStopGuardSelection({ options: OPTIONS, state, delta: 1 })).toEqual(state)
  })

  it('ignores sub-step deltas', () => {
    const opened = openStopGuard({ options: OPTIONS })
    expect(moveStopGuardSelection({ options: OPTIONS, state: opened, delta: 0.4 })).toEqual(opened)
  })

  it('resolves the selected enabled choice', () => {
    expect(resolveStopGuard({ options: OPTIONS, state: { selected: 2 } })).toBe(EChoice.Third)
  })

  it('refuses to resolve a disabled selection', () => {
    expect(resolveStopGuard({ options: OPTIONS, state: { selected: 1 } })).toBeNull()
  })

  it('reports the selected option', () => {
    expect(selectedStopGuardOption({ options: OPTIONS, state: { selected: 0 } })?.choice).toBe(
      EChoice.First,
    )
  })
})
