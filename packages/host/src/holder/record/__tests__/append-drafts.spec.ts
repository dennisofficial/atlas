import { describe, expect, it } from 'bun:test'

import { inboxIdOf } from '../append-drafts'

describe('inboxIdOf', () => {
  it('reads the inbox id from the typed field', () => {
    expect(inboxIdOf({ type: 'user-said', text: 'hi', inboxId: 7 })).toBe(7)
  })

  it('consumes nothing for a requestId that merely starts with inbox:', () => {
    expect(inboxIdOf({ type: 'user-said', text: 'hi', requestId: 'inbox:3' })).toBeUndefined()
  })

  it('ignores a non-positive or fractional inbox id', () => {
    expect(inboxIdOf({ type: 'user-said', text: 'hi', inboxId: 0 })).toBeUndefined()
    expect(inboxIdOf({ type: 'user-said', text: 'hi', inboxId: 1.5 })).toBeUndefined()
  })

  it('ignores drafts that are not user-said', () => {
    expect(inboxIdOf({ type: 'input-consumed', inboxId: 4 })).toBeUndefined()
  })
})
