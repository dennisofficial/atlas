import { describe, expect, it } from 'bun:test'

import { freshKeysOf } from '../fresh-keys'

describe('freshKeysOf', () => {
  it('animates nothing on the first load', () => {
    expect(freshKeysOf({ previous: new Set(), next: ['a', 'b'] }).size).toBe(0)
  })

  it('marks only the keys that were not in the list before', () => {
    expect([...freshKeysOf({ previous: new Set(['a', 'b']), next: ['c', 'a', 'b'] })]).toEqual([
      'c',
    ])
  })

  it('marks nothing when rows only move or leave', () => {
    expect(freshKeysOf({ previous: new Set(['a', 'b']), next: ['b'] }).size).toBe(0)
  })
})
