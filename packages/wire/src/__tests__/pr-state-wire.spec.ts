import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire, prStateWireSchema } from '../pr-state-wire'

const state = {
  repo: 'o/r',
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  branch: 'fix/sidebar',
  state: EPullRequestStateWire.Open,
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: null,
}

describe('optional live pull request titles', () => {
  it('preserves a real title when provided', () => {
    expect(prStateWireSchema.parse({ ...state, title: 'Updated title' }).title).toBe(
      'Updated title',
    )
  })

  it('accepts older live states without inventing a title', () => {
    expect(prStateWireSchema.parse(state)).toEqual(state)
  })

  it('rejects a non-string title', () => {
    expect(prStateWireSchema.safeParse({ ...state, title: 7 }).success).toBe(false)
  })
})
