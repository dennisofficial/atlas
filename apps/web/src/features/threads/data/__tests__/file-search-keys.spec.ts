import { describe, expect, it } from 'bun:test'

import { ESearchKeyAction, searchKeyResult } from '../file-search-keys'

describe('searchKeyResult', () => {
  it('clears on Escape even with no results', () => {
    expect(searchKeyResult({ key: 'Escape', active: 0, count: 0 })).toEqual({
      action: ESearchKeyAction.Clear,
    })
  })

  it('ignores navigation keys without results', () => {
    expect(searchKeyResult({ key: 'Enter', active: 0, count: 0 }).action).toBe(
      ESearchKeyAction.None,
    )
    expect(searchKeyResult({ key: 'ArrowDown', active: 0, count: 0 }).action).toBe(
      ESearchKeyAction.None,
    )
  })

  it('moves with wraparound', () => {
    expect(searchKeyResult({ key: 'ArrowDown', active: 2, count: 3 })).toEqual({
      action: ESearchKeyAction.Move,
      active: 0,
    })
    expect(searchKeyResult({ key: 'ArrowUp', active: 0, count: 3 })).toEqual({
      action: ESearchKeyAction.Move,
      active: 2,
    })
  })

  it('opens on Enter and ignores other keys', () => {
    expect(searchKeyResult({ key: 'Enter', active: 1, count: 3 }).action).toBe(
      ESearchKeyAction.Open,
    )
    expect(searchKeyResult({ key: 'a', active: 1, count: 3 }).action).toBe(ESearchKeyAction.None)
  })
})
